import {
  makeDedupeKey,
  type BatonTouchKind,
  type BatonTouchSourceType,
} from '../domain/baton-touch';
import { ConflictError, InvalidTransitionError } from '../domain/errors';
import type { DbLike } from '../domain/types';
import { nowIso } from '../domain/types';
import {
  findByDedupeKey,
  getBatonTouch,
  insertBatonTouch,
  listOpenTouchesBySource,
  updateBatonTouchFields,
  type BatonTouchRow,
} from '../repositories/baton-touches';
import { computeTouchRank } from './touch-ranking';
import { runTx } from './tx';

export type ProjectTouchInput = {
  kind: BatonTouchKind;
  sourceType: BatonTouchSourceType | string;
  sourceId: string;
  sourceVersion: number;
  taskId?: string | null;
  runId?: string | null;
  sourceEventId: string;
  workMode?: string | null;
  dueAt?: string | null;
  impact?: number | null;
  urgency?: number | null;
  effort?: number | null;
  depsSatisfied?: boolean;
  openedSnapshot?: Record<string, unknown>;
  supersedePriorVersions?: boolean;
};

function rankFor(input: ProjectTouchInput, openedAt: string, escalatedAt?: string | null) {
  return computeTouchRank({
    kind: input.kind,
    impact: input.impact,
    urgency: input.urgency,
    effort: input.effort,
    depsSatisfied: input.depsSatisfied,
    openedAt,
    escalatedAt: escalatedAt ?? null,
    workModeBias: 0,
  });
}

/**
 * Idempotent create/upsert by dedupe_key. Optionally supersede older open versions.
 */
export function projectTouch(db: DbLike, input: ProjectTouchInput): BatonTouchRow {
  return runTx(db, () => {
    const dedupeKey = makeDedupeKey(input.sourceType, input.sourceId, input.sourceVersion);
    const existing = findByDedupeKey(db, dedupeKey);
    if (existing) {
      if (['resolved', 'superseded', 'cancelled'].includes(String(existing.status))) {
        return existing;
      }
      // Refresh rebuildable rank fields only; preserve opened_snapshot and human fields.
      const explanation = rankFor(input, existing.opened_at, existing.escalated_at);
      return updateBatonTouchFields(db, existing.id, Number(existing.version || 1), {
        rank_score:
          existing.manual_rank_override != null
            ? Number(existing.manual_rank_override)
            : explanation.score,
        rank_explanation_json: JSON.stringify(explanation),
        task_id: input.taskId ?? existing.task_id,
        run_id: input.runId ?? existing.run_id,
        work_mode: input.workMode ?? existing.work_mode,
        due_at: input.dueAt ?? existing.due_at,
      });
    }

    if (input.supersedePriorVersions !== false) {
      const priors = listOpenTouchesBySource(db, String(input.sourceType), input.sourceId);
      for (const prior of priors) {
        if (Number(prior.source_version) < Number(input.sourceVersion)) {
          updateBatonTouchFields(db, prior.id, Number(prior.version || 1), {
            status: 'superseded',
            resolved_at: nowIso(),
            resolution_event_id: input.sourceEventId,
          });
        }
      }
    }

    const openedAt = nowIso();
    const explanation = rankFor(input, openedAt);
    const snapshot = {
      ...(input.openedSnapshot || {}),
      kind: input.kind,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      sourceVersion: input.sourceVersion,
      rank: explanation,
    };
    return insertBatonTouch(db, {
      kind: input.kind,
      sourceType: String(input.sourceType),
      sourceId: input.sourceId,
      sourceVersion: input.sourceVersion,
      taskId: input.taskId,
      runId: input.runId,
      sourceEventId: input.sourceEventId,
      dedupeKey,
      workMode: input.workMode,
      dueAt: input.dueAt,
      rankScore: explanation.score,
      rankExplanationJson: JSON.stringify(explanation),
      openedAt,
      openedSnapshotJson: JSON.stringify(snapshot),
    });
  });
}

export function resolveTouch(
  db: DbLike,
  touchId: string,
  opts: {
    expectedVersion?: number;
    resolvedBy?: string | null;
    resolutionEventId?: string | null;
    expectedSourceVersion?: number;
  } = {}
): BatonTouchRow {
  return runTx(db, () => {
    const touch = getBatonTouch(db, touchId);
    // Idempotent: terminal rows return as-is before version checks.
    if (['resolved', 'superseded', 'cancelled'].includes(String(touch.status))) {
      return touch;
    }
    if (opts.expectedVersion != null && Number(touch.version) !== Number(opts.expectedVersion)) {
      throw new ConflictError('BatonTouch version conflict', {
        touchId,
        expectedVersion: opts.expectedVersion,
        actualVersion: touch.version,
      });
    }
    if (
      opts.expectedSourceVersion != null &&
      Number(touch.source_version) !== Number(opts.expectedSourceVersion)
    ) {
      throw new ConflictError('BatonTouch source version mismatch', {
        touchId,
        expectedSourceVersion: opts.expectedSourceVersion,
        actualSourceVersion: touch.source_version,
      });
    }
    return updateBatonTouchFields(db, touch.id, Number(touch.version || 1), {
      status: 'resolved',
      resolved_at: nowIso(),
      resolved_by: opts.resolvedBy ?? null,
      resolution_event_id: opts.resolutionEventId ?? null,
      snoozed_until: null,
    });
  });
}

export function cancelTouch(
  db: DbLike,
  touchId: string,
  opts: { expectedVersion?: number; resolutionEventId?: string | null } = {}
): BatonTouchRow {
  return runTx(db, () => {
    const touch = getBatonTouch(db, touchId);
    if (opts.expectedVersion != null && Number(touch.version) !== Number(opts.expectedVersion)) {
      throw new ConflictError('BatonTouch version conflict', {
        touchId,
        expectedVersion: opts.expectedVersion,
      });
    }
    if (['resolved', 'superseded', 'cancelled'].includes(String(touch.status))) {
      return touch;
    }
    return updateBatonTouchFields(db, touch.id, Number(touch.version || 1), {
      status: 'cancelled',
      resolved_at: nowIso(),
      resolution_event_id: opts.resolutionEventId ?? null,
      snoozed_until: null,
    });
  });
}

export function resolveOpenTouchesForSource(
  db: DbLike,
  sourceType: string,
  sourceId: string,
  opts: { resolvedBy?: string | null; resolutionEventId?: string | null } = {}
): BatonTouchRow[] {
  const open = listOpenTouchesBySource(db, sourceType, sourceId);
  return open.map((t) =>
    resolveTouch(db, t.id, {
      expectedVersion: Number(t.version || 1),
      resolvedBy: opts.resolvedBy,
      resolutionEventId: opts.resolutionEventId,
    })
  );
}

export function requireAttentionTouch(db: DbLike, touchId: string): BatonTouchRow {
  const touch = getBatonTouch(db, touchId);
  if (['resolved', 'superseded', 'cancelled'].includes(String(touch.status))) {
    throw new InvalidTransitionError('Touch is terminal and cannot receive attention actions', {
      touchId,
      status: touch.status,
    });
  }
  return touch;
}
