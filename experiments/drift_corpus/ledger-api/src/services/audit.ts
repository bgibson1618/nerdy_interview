// Append-only audit log writer.
//
// Every state change writes exactly one immutable audit_events row. Rows are
// never updated or deleted. When called inside a transfer transaction the same
// PoolClient is passed so the audit row commits or rolls back atomically with
// the transfer; account lifecycle events are logged on the shared pool.

import { PoolClient } from 'pg';
import { query } from '../db/pool';
import { AuditAction } from '../types';

type Queryable = Pick<PoolClient, 'query'>;

export async function recordAudit(
  action: AuditAction,
  entityId: string,
  detail: Record<string, unknown>,
  client?: Queryable,
): Promise<void> {
  const sql = `INSERT INTO audit_events (action, entity_id, detail)
               VALUES ($1, $2, $3)`;
  const params = [action, entityId, JSON.stringify(detail)];
  if (client) {
    await client.query(sql, params);
  } else {
    await query(sql, params);
  }
}
