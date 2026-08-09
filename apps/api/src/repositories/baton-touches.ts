import { ConflictError, NotFoundError } from '../domain/errors';
import type { BatonTouchKind, BatonTouchStatus } from '../domain/baton-touch';
import type { DbLike } from '../domain/types';
import { newId, nowIso } from '../domain/types';

export type BatonTouchRow = {
  id: string;
  kind: BatonTouchKind | string;
  source_type: string;
  source_id: string;
  source_version: number;
  task_id: string | null;
  run_id: string | null;
  status: BatonTouchStatus | string;
  assignee_id: string | null;
  seen_at: string | null;
  snoozed_until: string | null;
  rank_score: number;
  rank_explanation_json: string;
  manual_rank_override: number | null;
  work_mode: string | null;
  opened_at: string;
  due_at: string | null;
  escalated_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_event_id: string | null;
  source_event_id: string;
  dedupe_key: string;
  opened_snapshot_json: string;
  created_at: string;
  updated_at: string;
  version: number;
};

export type InsertBatonTouchInput = {
  kind: string;
  sourceType: string;
  sourceId: string;
  sourceVersion: number;
  taskId?: string | null;
  runId?: string | null;
  status?: string;
  assigneeId?: string | null;
  rankScore?: number;
  rankExplanationJson?: string;
  manualRankOverride?: number | null;
  workMode?: string | null;
  openedAt?: string;
  dueAt?: string | null;
  sourceEventId: string;
  dedupeKey: string;
  openedSnapshotJson?: string;
  id?: string;
};

export function getBatonTouch(db: DbLike, id: string): BatonTouchRow {
  const row = db.prepare('SELECT * FROM baton_touches WHERE id = ?').get(id) as
    | BatonTouchRow
    | undefined;
  if (!row) throw new NotFoundError(`BatonTouch not found: ${id}`, { id });
  return row;
}

export function findByDedupeKey(db: DbLike, dedupeKey: string): BatonTouchRow | null {
  return (
    (db.prepare('SELECT * FROM baton_touches WHERE dedupe_key = ?').get(dedupeKey) as
      | BatonTouchRow
      | undefined) || null
  );
}

export function listOpenTouchesBySource(
  db: DbLike,
  sourceType: string,
  sourceId: string
): BatonTouchRow[] {
  return db
    .prepare(
      `SELECT * FROM baton_touches
       WHERE source_type = ? AND source_id = ?
         AND status IN ('open', 'snoozed')
       ORDER BY source_version DESC, opened_at DESC`
    )
    .all(sourceType, sourceId) as BatonTouchRow[];
}

export function listAttentionTouches(
  db: DbLike,
  opts: { includeSnoozed?: boolean; limit?: number } = {}
): BatonTouchRow[] {
  const includeSnoozed = opts.includeSnoozed !== false;
  const limit = Math.min(Math.max(Number(opts.limit || 50), 1), 200);
  const now = nowIso();
  if (includeSnoozed) {
    return db
      .prepare(
        `SELECT * FROM baton_touches
         WHERE status = 'open'
            OR (status = 'snoozed' AND (snoozed_until IS NULL OR snoozed_until <= ?))
         ORDER BY rank_score DESC,
                  CASE WHEN due_at IS NULL THEN 1 ELSE 0 END,
                  due_at ASC,
                  opened_at ASC,
                  id ASC
         LIMIT ?`
      )
      .all(now, limit) as BatonTouchRow[];
  }
  return db
    .prepare(
      `SELECT * FROM baton_touches
       WHERE status = 'open'
       ORDER BY rank_score DESC,
                CASE WHEN due_at IS NULL THEN 1 ELSE 0 END,
                due_at ASC,
                opened_at ASC,
                id ASC
       LIMIT ?`
    )
    .all(limit) as BatonTouchRow[];
}

export function insertBatonTouch(db: DbLike, input: InsertBatonTouchInput): BatonTouchRow {
  const id = input.id || newId('touch');
  const now = nowIso();
  const openedAt = input.openedAt || now;
  db.prepare(
    `INSERT INTO baton_touches (
       id, kind, source_type, source_id, source_version, task_id, run_id, status,
       assignee_id, rank_score, rank_explanation_json, manual_rank_override, work_mode,
       opened_at, due_at, source_event_id, dedupe_key, opened_snapshot_json,
       created_at, updated_at, version
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
  ).run(
    id,
    input.kind,
    input.sourceType,
    input.sourceId,
    input.sourceVersion,
    input.taskId ?? null,
    input.runId ?? null,
    input.status || 'open',
    input.assigneeId ?? null,
    input.rankScore ?? 0,
    input.rankExplanationJson || '{}',
    input.manualRankOverride ?? null,
    input.workMode ?? null,
    openedAt,
    input.dueAt ?? null,
    input.sourceEventId,
    input.dedupeKey,
    input.openedSnapshotJson || '{}',
    now,
    now
  );
  return getBatonTouch(db, id);
}

export function updateBatonTouchFields(
  db: DbLike,
  id: string,
  expectedVersion: number,
  fields: Record<string, unknown>
): BatonTouchRow {
  const allowed = [
    'status',
    'assignee_id',
    'seen_at',
    'snoozed_until',
    'rank_score',
    'rank_explanation_json',
    'manual_rank_override',
    'work_mode',
    'due_at',
    'escalated_at',
    'resolved_at',
    'resolved_by',
    'resolution_event_id',
    'task_id',
    'run_id',
  ];
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      sets.push(`${key} = ?`);
      params.push(fields[key]);
    }
  }
  if (!sets.length) return getBatonTouch(db, id);
  sets.push("updated_at = ?");
  params.push(nowIso());
  sets.push('version = version + 1');
  params.push(id, expectedVersion);
  const result = db
    .prepare(
      `UPDATE baton_touches SET ${sets.join(', ')} WHERE id = ? AND version = ?`
    )
    .run(...params);
  if (!result.changes) {
    throw new ConflictError('BatonTouch version conflict', { id, expectedVersion });
  }
  return getBatonTouch(db, id);
}
