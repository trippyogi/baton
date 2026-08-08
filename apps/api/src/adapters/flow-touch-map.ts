import {
  LEGACY_FLOW_TYPE_TO_KIND,
  type BatonTouchKind,
} from '../domain/baton-touch';
import type { BatonTouchRow } from '../repositories/baton-touches';

export function mapLegacyFlowType(type: string): BatonTouchKind | null {
  if (Object.prototype.hasOwnProperty.call(LEGACY_FLOW_TYPE_TO_KIND, type)) {
    return LEGACY_FLOW_TYPE_TO_KIND[type] ?? null;
  }
  return null;
}

/** Shape a canonical BatonTouch into a Flow-compatible list item for adapters. */
export function toLegacyFlowTouchShape(touch: BatonTouchRow): Record<string, unknown> {
  const kindToType: Record<string, string> = {
    review_required: 'review',
    blocker_resolution_required: 'blocker',
    decision_required: 'decide',
    assignment_required: 'delegate',
    prioritization_required: 'delegate',
    capture_triage_required: 'capture',
  };
  const statusMap: Record<string, string> = {
    open: 'pending',
    snoozed: 'snoozed',
    resolved: 'resolved',
    superseded: 'archived',
    cancelled: 'archived',
  };
  let snapshot: Record<string, unknown> = {};
  try {
    snapshot = JSON.parse(touch.opened_snapshot_json || '{}') as Record<string, unknown>;
  } catch {
    snapshot = {};
  }
  let status = statusMap[String(touch.status)] || 'pending';
  if (
    String(touch.status) === 'snoozed' &&
    touch.snoozed_until &&
    Date.parse(String(touch.snoozed_until)) <= Date.now()
  ) {
    status = 'pending';
  }
  return {
    id: touch.id,
    task_id: touch.task_id,
    run_id: touch.run_id,
    type: kindToType[String(touch.kind)] || 'capture',
    status,
    title: snapshot.title || `${touch.kind}`,
    why_now: snapshot.why_now || '',
    score: touch.rank_score,
    rank: null,
    snoozed_until: touch.snoozed_until,
    source: 'baton_v1',
    kind: touch.kind,
    dedupe_key: touch.dedupe_key,
    source_type: touch.source_type,
    source_id: touch.source_id,
    source_version: touch.source_version,
    canonical: true,
  };
}

function legacyDedupeKey(row: Record<string, unknown>): string | null {
  const type = String(row.type || '');
  const kind = mapLegacyFlowType(type);
  if (!kind) return null;
  const taskId = row.task_id == null ? '' : String(row.task_id);
  return `${kind}::${taskId}`;
}

/**
 * Prefer canonical BatonTouch projections; drop legacy Flow rows that cover the same
 * kind+task so operators do not see duplicate queue entries after migration.
 */
export function mergeCanonicalAndLegacyTouches(
  canonical: BatonTouchRow[],
  legacy: Record<string, unknown>[],
  limit: number
): Record<string, unknown>[] {
  const shaped = canonical.map((t) => toLegacyFlowTouchShape(t));
  const seen = new Set(
    shaped.map((row) => {
      const kind = String(row.kind || '');
      const taskId = row.task_id == null ? '' : String(row.task_id);
      return `${kind}::${taskId}`;
    })
  );
  const filteredLegacy: Record<string, unknown>[] = [];
  for (const row of legacy) {
    const key = legacyDedupeKey(row);
    if (key && seen.has(key)) continue;
    // Also suppress rows already migrated to baton_touches (id migrated_<flowId>).
    if (canonical.some((t) => t.id === `migrated_${row.id}`)) continue;
    if (key) seen.add(key);
    filteredLegacy.push(row);
  }
  return [...shaped, ...filteredLegacy]
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, limit);
}
