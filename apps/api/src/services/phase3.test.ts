import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConflictError } from '../domain/errors';
import { createDecisionRequest, answerDecisionRequest } from '../services/decision-requests';
import { projectTouch, resolveTouch, cancelTouch } from '../services/touch-projection';
import { computeTouchRank } from '../services/touch-ranking';
import {
  escalateTouch,
  markSeen,
  setRankOverride,
  snoozeTouch,
  unsnoozeTouch,
} from '../services/touch-attention';
import { createTaskBlocker, resolveTaskBlocker } from '../services/task-blockers';
import { createReviewDecision } from '../services/review-decisions';
import { findByDedupeKey, listAttentionTouches } from '../repositories/baton-touches';
import { mapLegacyFlowType, mergeCanonicalAndLegacyTouches, toLegacyFlowTouchShape } from '../adapters/flow-touch-map';

const require = createRequire(__filename);
const Database = require('better-sqlite3') as typeof import('better-sqlite3');
const { applyMigrations } = require('../../../../scripts/lib/migrate-db.js') as {
  applyMigrations: (
    db: import('better-sqlite3').Database,
    opts: { dbPath: string; backup: boolean }
  ) => unknown;
};

const ROOT = path.join(__dirname, '..', '..', '..', '..');

function openMigratedDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baton-p3-'));
  const dbPath = path.join(dir, 't.db');
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(path.join(ROOT, 'server', 'schema.sql'), 'utf8'));
  applyMigrations(db, { dbPath, backup: false });
  return { db, dir };
}

describe('touch-rank-v1', () => {
  it('is deterministic and clamps', () => {
    const a = computeTouchRank({
      kind: 'review_required',
      impact: 8,
      urgency: 7,
      effort: 2,
      openedAt: '2026-01-01T00:00:00Z',
      now: new Date('2026-01-02T00:00:00Z'),
    });
    const b = computeTouchRank({
      kind: 'review_required',
      impact: 8,
      urgency: 7,
      effort: 2,
      openedAt: '2026-01-01T00:00:00Z',
      now: new Date('2026-01-02T00:00:00Z'),
    });
    expect(a.score).toBe(b.score);
    expect(a.algorithmVersion).toBe('touch-rank-v1');
    expect(a.score).toBeGreaterThan(0);
    expect(a.score).toBeLessThanOrEqual(200);
  });
});

describe('Phase 3 projection + attention + domain', () => {
  let cleanup: string | null = null;
  afterEach(() => {
    if (cleanup) {
      try {
        fs.rmSync(cleanup, { recursive: true, force: true });
      } catch (_) {
        /* ignore */
      }
      cleanup = null;
    }
  });

  it('projects idempotently and preserves opened snapshot on refresh', () => {
    const { db, dir } = openMigratedDb();
    cleanup = dir;
    db.prepare(
      `INSERT INTO tasks (id, title, status, version, objective, acceptance_criteria_json, why_now_json, legacy_payload_json, impact_score, urgency, effort_score)
       VALUES ('t1', 'Task', 'ready', 1, 'o', '[]', '{}', '{}', 8, 7, 2)`
    ).run();

    const first = projectTouch(db, {
      kind: 'decision_required',
      sourceType: 'decision_request',
      sourceId: 'd1',
      sourceVersion: 1,
      taskId: 't1',
      sourceEventId: 'evt1',
      impact: 8,
      urgency: 7,
      effort: 2,
      openedSnapshot: { title: 'Decide now' },
    });
    const again = projectTouch(db, {
      kind: 'decision_required',
      sourceType: 'decision_request',
      sourceId: 'd1',
      sourceVersion: 1,
      taskId: 't1',
      sourceEventId: 'evt1',
      impact: 9,
      urgency: 9,
      effort: 1,
      openedSnapshot: { title: 'Changed' },
    });
    expect(again.id).toBe(first.id);
    expect(JSON.parse(again.opened_snapshot_json).title).toBe('Decide now');
    expect(again.rank_score).not.toBe(first.rank_score);

    const v2 = projectTouch(db, {
      kind: 'decision_required',
      sourceType: 'decision_request',
      sourceId: 'd1',
      sourceVersion: 2,
      taskId: 't1',
      sourceEventId: 'evt2',
      impact: 8,
      urgency: 7,
      effort: 2,
    });
    expect(v2.id).not.toBe(first.id);
    expect(findByDedupeKey(db, 'decision_request:d1:v1')?.status).toBe('superseded');
  });

  it('supports attention endpoints without resolving work', () => {
    const { db, dir } = openMigratedDb();
    cleanup = dir;
    const touch = projectTouch(db, {
      kind: 'capture_triage_required',
      sourceType: 'triage_task',
      sourceId: 'task-x',
      sourceVersion: 1,
      sourceEventId: 'e1',
    });
    markSeen(db, touch.id);
    const snoozed = snoozeTouch(db, touch.id, '2099-01-01T00:00:00Z');
    expect(snoozed.status).toBe('snoozed');
    const open = unsnoozeTouch(db, touch.id);
    expect(open.status).toBe('open');
    const escalated = escalateTouch(db, touch.id);
    expect(escalated.escalated_at).toBeTruthy();
    const overridden = setRankOverride(db, touch.id, 199);
    expect(overridden.rank_score).toBe(199);
    expect(listAttentionTouches(db).some((t) => t.id === touch.id)).toBe(true);
  });

  it('DecisionRequest create/answer projects and resolves touches', () => {
    const { db, dir } = openMigratedDb();
    cleanup = dir;
    db.prepare(
      `INSERT INTO tasks (id, title, status, version, objective, acceptance_criteria_json, why_now_json, legacy_payload_json)
       VALUES ('t1', 'Task', 'ready', 1, 'o', '[]', '{}', '{}')`
    ).run();
    const decision = createDecisionRequest(db, {
      question: 'Ship?',
      taskId: 't1',
      options: ['yes', 'no'],
    });
    const touch = findByDedupeKey(db, `decision_request:${decision.id}:v1`);
    expect(touch?.kind).toBe('decision_required');
    answerDecisionRequest(db, decision.id, { choice: 'yes' }, 1);
    expect(findByDedupeKey(db, `decision_request:${decision.id}:v1`)?.status).toBe('resolved');
  });

  it('blocker + review decision domain commands resolve touches', () => {
    const { db, dir } = openMigratedDb();
    cleanup = dir;
    db.prepare(
      `INSERT INTO tasks (id, title, status, version, objective, acceptance_criteria_json, why_now_json, legacy_payload_json, impact_score, urgency, effort_score)
       VALUES ('t1', 'Task', 'in_progress', 1, 'o', '[]', '{}', '{}', 6, 6, 3)`
    ).run();
    const { blocker, touch } = createTaskBlocker(db, {
      taskId: 't1',
      reasonCode: 'need_input',
      summary: 'Need credentials',
    });
    expect(touch.kind).toBe('blocker_resolution_required');
    resolveTaskBlocker(db, String((blocker as { id: string }).id), { expectedVersion: 1 });
    expect(findByDedupeKey(db, `task_blocker:${(blocker as { id: string }).id}:v1`)?.status).toBe(
      'resolved'
    );

    db.prepare(
      `INSERT INTO review_packets (id, task_id, goal, summary, version, packet_status)
       VALUES ('rp1', 't1', 'goal', 'summary', 1, 'ready')`
    ).run();
    db.prepare(`UPDATE tasks SET status = 'human_review' WHERE id = ?`).run('t1');
    const reviewTouch = projectTouch(db, {
      kind: 'review_required',
      sourceType: 'review_packet',
      sourceId: 'rp1',
      sourceVersion: 1,
      taskId: 't1',
      sourceEventId: 'rp1',
    });
    const result = createReviewDecision(db, {
      reviewPacketId: 'rp1',
      decision: 'approve',
      touchId: reviewTouch.id,
      expectedVersion: 1,
    });
    expect(result.touch.status).toBe('resolved');
    expect(
      (db.prepare('SELECT status FROM tasks WHERE id = ?').get('t1') as { status: string }).status
    ).toBe('done');
  });

  it('adversarial: rejects generic resolve, wrong source version, terminal reopen', () => {
    const { db, dir } = openMigratedDb();
    cleanup = dir;
    const touch = projectTouch(db, {
      kind: 'assignment_required',
      sourceType: 'task_assignment',
      sourceId: 't9',
      sourceVersion: 1,
      sourceEventId: 'e',
    });
    resolveTouch(db, touch.id, { resolvedBy: 'op' });
    expect(() => resolveTouch(db, touch.id, { expectedSourceVersion: 99 })).not.toThrow();
    // already resolved — second resolve is idempotent without wrong version check when omitted
    expect(() =>
      resolveTouch(db, touch.id, { expectedSourceVersion: 1, resolvedBy: 'op' })
    ).not.toThrow();
    expect(() => cancelTouch(db, touch.id)).not.toThrow();

    const open = projectTouch(db, {
      kind: 'assignment_required',
      sourceType: 'task_assignment',
      sourceId: 't10',
      sourceVersion: 1,
      sourceEventId: 'e2',
    });
    expect(() =>
      resolveTouch(db, open.id, { expectedSourceVersion: 99 })
    ).toThrow(ConflictError);

    expect(mapLegacyFlowType('review')).toBe('review_required');
    expect(mapLegacyFlowType('refine')).toBeNull();
    expect(toLegacyFlowTouchShape(open).canonical).toBe(true);

    const merged = mergeCanonicalAndLegacyTouches(
      [
        {
          id: 'c1',
          kind: 'decision_required',
          task_id: 't1',
          status: 'open',
          rank_score: 10,
          opened_snapshot_json: '{"title":"Decide"}',
          snoozed_until: null,
          run_id: null,
          source_type: 'decision_request',
          source_id: 'd1',
          source_version: 1,
          dedupe_key: 'decision_request:d1:v1',
        } as never,
      ],
      [
        { id: 'flow-1', type: 'decide', task_id: 't1', status: 'pending', score: 5 },
        { id: 'flow-2', type: 'refine', task_id: 't1', status: 'pending', score: 3 },
      ],
      10
    );
    expect(merged.some((r) => r.canonical === true)).toBe(true);
    expect(merged.some((r) => r.id === 'flow-1')).toBe(false);
    expect(merged.some((r) => r.id === 'flow-2')).toBe(true);
  });

  it('escalation does not mutate task status', () => {
    const { db, dir } = openMigratedDb();
    cleanup = dir;
    db.prepare(
      `INSERT INTO tasks (id, title, status, version, objective, acceptance_criteria_json, why_now_json, legacy_payload_json)
       VALUES ('t1', 'Task', 'ready', 1, 'o', '[]', '{}', '{}')`
    ).run();
    const touch = projectTouch(db, {
      kind: 'prioritization_required',
      sourceType: 'task_prioritization',
      sourceId: 't1',
      sourceVersion: 1,
      taskId: 't1',
      sourceEventId: 'e',
    });
    escalateTouch(db, touch.id);
    expect(
      (db.prepare('SELECT status FROM tasks WHERE id = ?').get('t1') as { status: string }).status
    ).toBe('ready');
  });
});
