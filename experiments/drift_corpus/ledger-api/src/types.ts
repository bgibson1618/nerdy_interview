// Shared domain types for ledger-api.

// Account lifecycle. Accounts are soft-deleted: status flips to 'closed' and
// closed_at is set, but the row (and its entries) are retained forever.
export type AccountStatus = 'active' | 'closed';

// Direction of a single ledger entry within a transfer (double-entry).
export type EntryDirection = 'debit' | 'credit';

// Transfer lifecycle. A transfer is created 'pending', becomes 'posted' once the
// two balancing entries are written atomically, and 'settled' once the
// settlement webhook has been acknowledged. 'failed' is terminal.
export type TransferStatus = 'pending' | 'posted' | 'settled' | 'failed';

// Audit log action verbs.
export type AuditAction =
  | 'account.created'
  | 'account.closed'
  | 'transfer.posted'
  | 'transfer.settled'
  | 'transfer.failed';

// Token scopes. Every endpoint declares the scope it requires.
export type Scope =
  | 'accounts:read'
  | 'accounts:write'
  | 'transfers:read'
  | 'transfers:write';

export interface ApiToken {
  id: string;
  token_hash: string; // sha256 of the presented bearer token
  scopes: Scope[];
  created_at: string;
  revoked_at: string | null;
}

export interface Account {
  id: string;
  // ISO 4217 alphabetic code, e.g. 'USD'. An account holds exactly one currency.
  currency: string;
  // Cached balance in minor units. Always equals SUM(credits) - SUM(debits)
  // over this account's entries (the balance invariant).
  balance: number;
  status: AccountStatus;
  created_at: string;
  closed_at: string | null;
}

export interface Entry {
  id: string;
  transfer_id: string;
  account_id: string;
  direction: EntryDirection;
  // Always a positive integer in minor units.
  amount: number;
  created_at: string;
}

export interface Transfer {
  id: string;
  source_account_id: string;
  destination_account_id: string;
  // Gross amount moved, minor units, positive.
  amount: number;
  // Fee withheld from the destination, minor units, >= 0. Computed by applying
  // fee_bps to amount with HALF_EVEN rounding.
  fee: number;
  currency: string;
  status: TransferStatus;
  created_at: string;
  settled_at: string | null;
}

export interface IdempotencyKey {
  key: string;
  // Hash of the request body the key was first seen with; a replayed key with a
  // different body is a conflict (409).
  request_hash: string;
  response_status: number;
  response_body: string;
  created_at: string;
}

export interface AuditEvent {
  id: string;
  action: AuditAction;
  // The primary entity the event concerns (account id or transfer id).
  entity_id: string;
  // Free-form JSON snapshot, serialized.
  detail: string;
  created_at: string;
}

// Express request augmentation: requireScope attaches the authenticated token.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      token?: ApiToken;
    }
  }
}
