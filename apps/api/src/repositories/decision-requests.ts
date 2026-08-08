import { ConflictError, NotFoundError } from '../domain/errors';
import type { DecisionRequestStatus } from '../domain/decision-request';
import type { DbLike } from '../domain/types';
import { newId, nowIso } from '../domain/types';

export type DecisionRequestRow = {
  id: string;
  task_id: string | null;
  question: string;
  context_json: string;
  options_json: string;
  requester: string;
  status: DecisionRequestStatus;
  response_json: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  answered_at: string | null;
  cancelled_at: string | null;
};

export type CreateDecisionRequestInput = {
  question: string;
  taskId?: string | null;
  context?: unknown;
  options?: unknown;
  requester?: string;
  id?: string;
};

export function getDecisionRequest(db: DbLike, id: string): DecisionRequestRow {
  const row = db
    .prepare('SELECT * FROM decision_requests WHERE id = ?')
    .get(id) as DecisionRequestRow | undefined;
  if (!row) throw new NotFoundError(`DecisionRequest not found: ${id}`, { id });
  return row;
}

export function listDecisionRequests(
  db: DbLike,
  filter: { status?: string; taskId?: string } = {}
): DecisionRequestRow[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.status) {
    clauses.push('status = ?');
    params.push(filter.status);
  }
  if (filter.taskId) {
    clauses.push('task_id = ?');
    params.push(filter.taskId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db
    .prepare(
      `SELECT * FROM decision_requests ${where} ORDER BY updated_at DESC, rowid DESC`
    )
    .all(...params) as DecisionRequestRow[];
}

export function insertDecisionRequest(
  db: DbLike,
  input: CreateDecisionRequestInput
): DecisionRequestRow {
  const id = input.id || newId('decision');
  const now = nowIso();
  db.prepare(
    `INSERT INTO decision_requests (
       id, task_id, question, context_json, options_json, requester,
       status, version, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'open', 1, ?, ?)`
  ).run(
    id,
    input.taskId ?? null,
    input.question,
    JSON.stringify(input.context ?? {}),
    JSON.stringify(input.options ?? []),
    input.requester || 'system',
    now,
    now
  );
  return getDecisionRequest(db, id);
}

export function updateDecisionRequestStatus(
  db: DbLike,
  id: string,
  status: DecisionRequestStatus,
  expectedVersion: number,
  response: unknown = null
): DecisionRequestRow {
  const now = nowIso();
  const answeredAt = status === 'answered' ? now : null;
  const cancelledAt = status === 'cancelled' ? now : null;
  const result = db
    .prepare(
      `UPDATE decision_requests
       SET status = ?,
           response_json = CASE WHEN ? IS NOT NULL THEN ? ELSE response_json END,
           answered_at = COALESCE(?, answered_at),
           cancelled_at = COALESCE(?, cancelled_at),
           version = version + 1,
           updated_at = ?
       WHERE id = ? AND version = ?`
    )
    .run(
      status,
      response == null ? null : JSON.stringify(response),
      response == null ? null : JSON.stringify(response),
      answeredAt,
      cancelledAt,
      now,
      id,
      expectedVersion
    );
  if (!result.changes) {
    throw new ConflictError('DecisionRequest version conflict', { id, expectedVersion });
  }
  return getDecisionRequest(db, id);
}
