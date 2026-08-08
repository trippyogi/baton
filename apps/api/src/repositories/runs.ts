import { ConflictError, NotFoundError } from '../domain/errors';
import { SQL_TERMINAL_RUN_STATUSES, normalizeRunStatus } from '../domain/run-status';
import type { DbLike } from '../domain/types';
import { newId, nowIso } from '../domain/types';

export type RunRow = {
  id: string;
  task_id: string | null;
  status: string;
  version: number;
  parent_run_id: string | null;
  attempt_number: number;
  kind: string;
  current_dispatch_id?: string | null;
};

const TERMINAL_LIST = [...SQL_TERMINAL_RUN_STATUSES].map((s) => `'${s}'`).join(', ');

export function getRun(db: DbLike, runId: string): RunRow {
  const row = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as RunRow | undefined;
  if (!row) throw new NotFoundError(`Run not found: ${runId}`, { runId });
  return row;
}

export function assertRunVersion(run: RunRow, expectedVersion: number | undefined): void {
  if (expectedVersion == null) return;
  if (Number(run.version || 1) !== Number(expectedVersion)) {
    throw new ConflictError('Run version conflict', {
      runId: run.id,
      expectedVersion,
      actualVersion: run.version,
    });
  }
}

export function listNonTerminalRunsForTask(db: DbLike, taskId: string): RunRow[] {
  return db
    .prepare(
      `SELECT * FROM runs
       WHERE task_id = ?
         AND status NOT IN (${TERMINAL_LIST})
       ORDER BY created_at DESC, rowid DESC`
    )
    .all(taskId) as RunRow[];
}

export function findChildRun(db: DbLike, parentRunId: string): RunRow | null {
  return (
    (db.prepare('SELECT * FROM runs WHERE parent_run_id = ? LIMIT 1').get(parentRunId) as
      | RunRow
      | undefined) || null
  );
}

export function updateRunStatus(
  db: DbLike,
  runId: string,
  status: string,
  expectedVersion: number,
  extra: { endedAt?: string | null; resultKind?: string | null; failureMessage?: string | null } = {}
): RunRow {
  const updatedAt = nowIso();
  const result = db
    .prepare(
      `UPDATE runs
       SET status = ?,
           result_kind = COALESCE(?, result_kind),
           failure_message = COALESCE(?, failure_message),
           ended_at = CASE WHEN ? IS NOT NULL THEN ? ELSE ended_at END,
           version = version + 1,
           updated_at = ?
       WHERE id = ? AND version = ?`
    )
    .run(
      status,
      extra.resultKind ?? null,
      extra.failureMessage ?? null,
      extra.endedAt ?? null,
      extra.endedAt ?? null,
      updatedAt,
      runId,
      expectedVersion
    );
  if (!result.changes) {
    throw new ConflictError('Run version conflict on update', { runId, expectedVersion });
  }
  return getRun(db, runId);
}

export function insertChildRun(
  db: DbLike,
  parent: RunRow,
  opts: { kind?: string; status?: string } = {}
): RunRow {
  const id = newId('run');
  const createdAt = nowIso();
  const kind = opts.kind || 'refine';
  const status = normalizeRunStatus(opts.status || 'pending_dispatch');
  db.prepare(
    `INSERT INTO runs (
       id, task_id, parent_run_id, attempt_number, kind, status,
       input_snapshot_json, policy_json, version, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, '{}', '{}', 1, ?, ?)`
  ).run(
    id,
    parent.task_id,
    parent.id,
    Number(parent.attempt_number || 1) + 1,
    kind,
    status,
    createdAt,
    createdAt
  );
  return getRun(db, id);
}
