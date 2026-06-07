// Double-entry transfer engine.
//
// A transfer moves `amount` minor units from a source account to a destination
// account in the SAME currency. A fee (fee_bps basis points of amount, rounded
// HALF_EVEN) is withheld from the destination and credited to the platform fee
// account. The whole thing is posted atomically:
//
//   BEGIN
//     lock + re-read both accounts (FOR UPDATE) in a deterministic order
//     validate: both active, same currency, source has sufficient balance
//     insert transfer (status 'posted')
//     insert entries: debit source(amount), credit destination(amount-fee),
//                     and (if fee>0) credit fee account(fee)
//     update cached balances
//     write audit row 'transfer.posted'
//   COMMIT
//
// If any step throws, the whole transaction rolls back and nothing is written
// (atomicity). The cached balance on each account always equals
// SUM(credits) - SUM(debits) for that account (the balance invariant): a debit
// lowers balance, a credit raises it.

import { PoolClient } from 'pg';
import { withTransaction } from '../db/pool';
import { HttpError } from '../middleware/errorHandler';
import { recordAudit } from './audit';
import { computeFee, netToDestination } from '../utils/money';
import { Account, Transfer } from '../types';

// Basis points withheld as a fee on every transfer (2.9% = 290 bps).
export const FEE_BPS = 190;

// Accounts are locked in a fixed id order to prevent deadlocks between two
// concurrent transfers that touch the same pair of accounts.
async function lockAccounts(
  client: PoolClient,
  ids: string[],
): Promise<Map<string, Account>> {
  const ordered = [...new Set(ids)].sort();
  const rows = await client.query(
    'SELECT * FROM accounts WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE',
    [ordered],
  );
  const map = new Map<string, Account>();
  for (const row of rows.rows as Account[]) {
    map.set(row.id, row);
  }
  return map;
}

export interface CreateTransferInput {
  sourceAccountId: string;
  destinationAccountId: string;
  feeAccountId: string;
  amount: number; // positive integer, minor units
}

export async function createTransfer(
  input: CreateTransferInput,
): Promise<Transfer> {
  const { sourceAccountId, destinationAccountId, feeAccountId, amount } = input;

  if (!Number.isInteger(amount) || amount <= 0) {
    throw new HttpError(400, 'amount must be a positive integer (minor units)');
  }
  if (sourceAccountId === destinationAccountId) {
    throw new HttpError(400, 'source and destination must differ');
  }

  return withTransaction(async (client) => {
    const accounts = await lockAccounts(client, [
      sourceAccountId,
      destinationAccountId,
      feeAccountId,
    ]);
    const source = accounts.get(sourceAccountId);
    const destination = accounts.get(destinationAccountId);
    const feeAccount = accounts.get(feeAccountId);

    if (!source || !destination || !feeAccount) {
      throw new HttpError(404, 'account not found');
    }
    if (source.status !== 'active' || destination.status !== 'active') {
      throw new HttpError(409, 'both accounts must be active');
    }
    if (
      source.currency !== destination.currency ||
      source.currency !== feeAccount.currency
    ) {
      throw new HttpError(422, 'currency mismatch');
    }

    const fee = computeFee(amount, FEE_BPS);
    const net = netToDestination(amount, fee);

    // Sufficient-funds check happens AFTER locking, against the fresh balance.
    if (source.balance < amount) {
      throw new HttpError(422, 'insufficient funds');
    }

    const transferRows = await client.query(
      `INSERT INTO transfers
         (source_account_id, destination_account_id, amount, fee, currency, status)
       VALUES ($1, $2, $3, $4, $5, 'posted')
       RETURNING *`,
      [sourceAccountId, destinationAccountId, amount, fee, source.currency],
    );
    const transfer = transferRows.rows[0] as Transfer;

    // Debit the source the full gross amount.
    await client.query(
      `INSERT INTO entries (transfer_id, account_id, direction, amount)
       VALUES ($1, $2, 'debit', $3)`,
      [transfer.id, sourceAccountId, amount],
    );
    // Credit the destination the net (gross minus fee).
    await client.query(
      `INSERT INTO entries (transfer_id, account_id, direction, amount)
       VALUES ($1, $2, 'credit', $3)`,
      [transfer.id, destinationAccountId, net],
    );
    // Credit the fee account the fee, only when there is one.
    if (fee > 0) {
      await client.query(
        `INSERT INTO entries (transfer_id, account_id, direction, amount)
         VALUES ($1, $2, 'credit', $3)`,
        [transfer.id, feeAccountId, fee],
      );
    }

    // Update cached balances consistently with the entries above.
    await client.query('UPDATE accounts SET balance = balance - $1 WHERE id = $2', [
      amount,
      sourceAccountId,
    ]);
    await client.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2', [
      amount,
      destinationAccountId,
    ]);
    if (fee > 0) {
      await client.query(
        'UPDATE accounts SET balance = balance + $1 WHERE id = $2',
        [fee, feeAccountId],
      );
    }

    await recordAudit(
      'transfer.posted',
      transfer.id,
      { amount, fee, net, currency: source.currency },
      client,
    );

    return transfer;
  });
}
