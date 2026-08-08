'use strict';

/**
 * One-way Flow → BatonTouch projection (T3.8).
 * Does not fabricate ACK/review history. Skips kinds that lack canonical sources.
 */
module.exports = function migrateFlowTouchesToBaton(db) {
  const hasFlow = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='flow_touches'")
    .get();
  const hasBaton = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='baton_touches'")
    .get();
  if (!hasFlow || !hasBaton) return;

  const typeToKind = {
    review: 'review_required',
    blocker: 'blocker_resolution_required',
    decide: 'decision_required',
    strategy: 'decision_required',
    delegate: 'assignment_required',
    idle_agent: 'assignment_required',
    capture: 'capture_triage_required',
  };

  const statusMap = {
    pending: 'open',
    active: 'open',
    prepared: 'open',
    snoozed: 'snoozed',
    resolved: 'resolved',
    passed: 'resolved',
    archived: 'cancelled',
  };

  const rows = db.prepare('SELECT * FROM flow_touches').all();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO baton_touches (
      id, kind, source_type, source_id, source_version, task_id, run_id, status,
      assignee_id, seen_at, snoozed_until, rank_score, rank_explanation_json,
      manual_rank_override, work_mode, opened_at, due_at, escalated_at,
      resolved_at, resolved_by, resolution_event_id, source_event_id, dedupe_key,
      opened_snapshot_json, created_at, updated_at, version
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?,
      NULL, NULL, ?, ?, ?,
      ?, NULL, ?, NULL, NULL,
      ?, NULL, NULL, ?, ?,
      ?, ?, ?, 1
    )
  `);

  for (const row of rows) {
    const kind = typeToKind[String(row.type || '')];
    if (!kind) continue; // refine/stale_run/etc. are not BatonTouch kinds

    let sourceType = 'triage_task';
    let sourceId = row.task_id || row.id;
    let sourceVersion = 1;

    if (kind === 'review_required') {
      if (!row.review_packet_id) continue; // no fabricated review packet
      sourceType = 'review_packet';
      sourceId = row.review_packet_id;
      const packet = db
        .prepare('SELECT version FROM review_packets WHERE id = ?')
        .get(row.review_packet_id);
      sourceVersion = Number(packet?.version || 1);
    } else if (kind === 'blocker_resolution_required') {
      // Prefer an open blocker for the task; otherwise skip (no fabricated blocker).
      const blocker = row.task_id
        ? db
            .prepare(
              `SELECT id, version FROM task_blockers
               WHERE task_id = ? AND status = 'open'
               ORDER BY created_at DESC LIMIT 1`
            )
            .get(row.task_id)
        : null;
      if (!blocker) continue;
      sourceType = 'task_blocker';
      sourceId = blocker.id;
      sourceVersion = Number(blocker.version || 1);
    } else if (kind === 'decision_required') {
      const decision = row.task_id
        ? db
            .prepare(
              `SELECT id, version FROM decision_requests
               WHERE task_id = ? AND status = 'open'
               ORDER BY created_at DESC LIMIT 1`
            )
            .get(row.task_id)
        : null;
      if (!decision) continue;
      sourceType = 'decision_request';
      sourceId = decision.id;
      sourceVersion = Number(decision.version || 1);
    } else if (kind === 'assignment_required') {
      sourceType = 'task_assignment';
      sourceId = row.task_id || row.id;
    } else if (kind === 'capture_triage_required') {
      sourceType = 'triage_task';
      sourceId = row.task_id || row.id;
    }

    const dedupeKey = `${sourceType}:${sourceId}:v${sourceVersion}`;
    const status = statusMap[String(row.status || 'pending')] || 'open';
    const openedAt = row.created_at || row.generated_at || new Date().toISOString();
    const updatedAt = row.updated_at || openedAt;
    const explanation = JSON.stringify({
      algorithmVersion: 'touch-rank-v1',
      score: Number(row.score || 0),
      factors: [],
      summary: 'migrated from flow_touches',
      calculatedAt: updatedAt,
      migrated: true,
    });
    const snapshot = JSON.stringify({
      migratedFrom: 'flow_touches',
      legacyType: row.type,
      legacyStatus: row.status,
      title: row.title,
      why_now: row.why_now,
      impact: row.impact_score,
      urgency: row.urgency_score,
      effort: row.effort_score,
    });

    insert.run(
      `migrated_${row.id}`,
      kind,
      sourceType,
      sourceId,
      sourceVersion,
      row.task_id || null,
      row.run_id || null,
      status,
      row.snoozed_until || null,
      Number(row.score || 0),
      explanation,
      row.manual_priority_boost != null ? Number(row.manual_priority_boost) : null,
      openedAt,
      row.resolved_at || null,
      `migrate:${row.id}`,
      dedupeKey,
      snapshot,
      openedAt,
      updatedAt
    );
  }
};
