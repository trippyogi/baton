import { computeTouchRank } from './touch-ranking';
import { ConflictError } from '../domain/errors';
import type { DbLike } from '../domain/types';
import { nowIso } from '../domain/types';
import {
  getBatonTouch,
  updateBatonTouchFields,
  type BatonTouchRow,
} from '../repositories/baton-touches';
import { requireAttentionTouch } from './touch-projection';
import { runTx } from './tx';

function parseJson(raw: string | null | undefined): Record<string, unknown> {
  try {
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function refreshRank(touch: BatonTouchRow): { score: number; explanationJson: string } {
  const snapshot = parseJson(touch.opened_snapshot_json);
  const explanation = computeTouchRank({
    kind: String(touch.kind),
    impact: Number((snapshot.impact as number) ?? 5),
    urgency: Number((snapshot.urgency as number) ?? 5),
    effort: Number((snapshot.effort as number) ?? 5),
    depsSatisfied: snapshot.depsSatisfied !== false,
    openedAt: touch.opened_at,
    escalatedAt: touch.escalated_at,
    workModeBias: 0,
    manualRankOverride: touch.manual_rank_override,
  });
  const score =
    touch.manual_rank_override != null ? Number(touch.manual_rank_override) : explanation.score;
  return { score, explanationJson: JSON.stringify(explanation) };
}

export function markSeen(db: DbLike, touchId: string, expectedVersion?: number): BatonTouchRow {
  return runTx(db, () => {
    const touch = requireAttentionTouch(db, touchId);
    if (expectedVersion != null && Number(touch.version) !== Number(expectedVersion)) {
      throw new ConflictError('BatonTouch version conflict', { touchId, expectedVersion });
    }
    return updateBatonTouchFields(db, touch.id, Number(touch.version || 1), {
      seen_at: nowIso(),
    });
  });
}

export function snoozeTouch(
  db: DbLike,
  touchId: string,
  until: string,
  expectedVersion?: number
): BatonTouchRow {
  return runTx(db, () => {
    const touch = requireAttentionTouch(db, touchId);
    if (expectedVersion != null && Number(touch.version) !== Number(expectedVersion)) {
      throw new ConflictError('BatonTouch version conflict', { touchId, expectedVersion });
    }
    if (!until) throw new ConflictError('snooze requires until');
    return updateBatonTouchFields(db, touch.id, Number(touch.version || 1), {
      status: 'snoozed',
      snoozed_until: until,
    });
  });
}

export function unsnoozeTouch(
  db: DbLike,
  touchId: string,
  expectedVersion?: number
): BatonTouchRow {
  return runTx(db, () => {
    const touch = getBatonTouch(db, touchId);
    if (expectedVersion != null && Number(touch.version) !== Number(expectedVersion)) {
      throw new ConflictError('BatonTouch version conflict', { touchId, expectedVersion });
    }
    if (String(touch.status) !== 'snoozed' && String(touch.status) !== 'open') {
      return touch;
    }
    return updateBatonTouchFields(db, touch.id, Number(touch.version || 1), {
      status: 'open',
      snoozed_until: null,
    });
  });
}

export function assignTouch(
  db: DbLike,
  touchId: string,
  assigneeId: string | null,
  expectedVersion?: number
): BatonTouchRow {
  return runTx(db, () => {
    const touch = requireAttentionTouch(db, touchId);
    if (expectedVersion != null && Number(touch.version) !== Number(expectedVersion)) {
      throw new ConflictError('BatonTouch version conflict', { touchId, expectedVersion });
    }
    return updateBatonTouchFields(db, touch.id, Number(touch.version || 1), {
      assignee_id: assigneeId,
    });
  });
}

export function claimTouch(
  db: DbLike,
  touchId: string,
  claimantId: string,
  expectedVersion?: number
): BatonTouchRow {
  return assignTouch(db, touchId, claimantId, expectedVersion);
}

export function setRankOverride(
  db: DbLike,
  touchId: string,
  override: number | null,
  expectedVersion?: number
): BatonTouchRow {
  return runTx(db, () => {
    const touch = requireAttentionTouch(db, touchId);
    if (expectedVersion != null && Number(touch.version) !== Number(expectedVersion)) {
      throw new ConflictError('BatonTouch version conflict', { touchId, expectedVersion });
    }
    const withOverride = {
      ...touch,
      manual_rank_override: override,
    } as BatonTouchRow;
    const ranked = refreshRank(withOverride);
    return updateBatonTouchFields(db, touch.id, Number(touch.version || 1), {
      manual_rank_override: override,
      rank_score: ranked.score,
      rank_explanation_json: ranked.explanationJson,
    });
  });
}

export function escalateTouch(
  db: DbLike,
  touchId: string,
  expectedVersion?: number
): BatonTouchRow {
  return runTx(db, () => {
    const touch = requireAttentionTouch(db, touchId);
    if (expectedVersion != null && Number(touch.version) !== Number(expectedVersion)) {
      throw new ConflictError('BatonTouch version conflict', { touchId, expectedVersion });
    }
    const escalatedAt = touch.escalated_at || nowIso();
    const ranked = refreshRank({ ...touch, escalated_at: escalatedAt });
    return updateBatonTouchFields(db, touch.id, Number(touch.version || 1), {
      escalated_at: escalatedAt,
      rank_score: ranked.score,
      rank_explanation_json: ranked.explanationJson,
    });
  });
}
