import { ConflictError, InvalidTransitionError, NotFoundError } from '../domain/errors';
import type { DbLike } from '../domain/types';
import { newId, nowIso } from '../domain/types';
import { getBatonTouch } from '../repositories/baton-touches';
import { resolveTouch } from './touch-projection';
import { transitionTask } from './task-transitions';
import { runTx } from './tx';

export type ReviewDecisionInput = {
  reviewPacketId: string;
  decision: 'approve' | 'request_changes' | 'reject';
  touchId: string;
  expectedVersion?: number;
  expectedTaskVersion?: number;
  reason?: string | null;
  idempotencyKey?: string;
  actor?: string;
};

export function createReviewDecision(db: DbLike, input: ReviewDecisionInput) {
  return runTx(db, () => {
    const packet = db
      .prepare('SELECT * FROM review_packets WHERE id = ?')
      .get(input.reviewPacketId) as Record<string, unknown> | undefined;
    if (!packet) {
      throw new NotFoundError(`Review packet not found: ${input.reviewPacketId}`);
    }

    const touch = getBatonTouch(db, input.touchId);
    if (touch.source_type !== 'review_packet' || touch.source_id !== input.reviewPacketId) {
      throw new ConflictError('touchId does not match review packet source', {
        touchId: input.touchId,
        reviewPacketId: input.reviewPacketId,
      });
    }
    if (input.expectedVersion != null && Number(touch.source_version) !== Number(input.expectedVersion)) {
      throw new ConflictError('Review touch source version mismatch', {
        expectedVersion: input.expectedVersion,
        actualVersion: touch.source_version,
      });
    }
    if (!['approve', 'request_changes', 'reject'].includes(input.decision)) {
      throw new InvalidTransitionError(`Invalid review decision: ${input.decision}`);
    }

    const idempotencyKey =
      input.idempotencyKey ||
      `review_decision:${input.reviewPacketId}:${input.decision}:${input.touchId}`;
    const existing = db
      .prepare('SELECT * FROM review_decisions WHERE idempotency_key = ?')
      .get(idempotencyKey) as Record<string, unknown> | undefined;
    if (existing) {
      return { decision: existing, touch: getBatonTouch(db, input.touchId), reused: true };
    }

    if (['resolved', 'superseded', 'cancelled'].includes(String(touch.status))) {
      throw new ConflictError('Review touch is terminal; cannot create a new decision', {
        touchId: input.touchId,
        status: touch.status,
      });
    }

    const taskId = String(packet.task_id || touch.task_id || '');
    if (!taskId) throw new InvalidTransitionError('Review packet missing task_id');

    const decisionId = newId('revdec');
    const now = nowIso();
    db.prepare(
      `INSERT INTO review_decisions (
         id, review_packet_id, task_id, decision, reason, idempotency_key,
         expected_task_version, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      decisionId,
      input.reviewPacketId,
      taskId,
      input.decision,
      input.reason ?? null,
      idempotencyKey,
      input.expectedTaskVersion ?? 0,
      now
    );

    const toStatus =
      input.decision === 'approve'
        ? 'done'
        : input.decision === 'request_changes'
          ? 'in_progress'
          : 'cancelled';
    transitionTask(db, {
      taskId,
      toStatus,
      expectedVersion: input.expectedTaskVersion,
    });

    const resolved = resolveTouch(db, input.touchId, {
      expectedSourceVersion: Number(touch.source_version),
      resolvedBy: input.actor || 'operator',
      resolutionEventId: decisionId,
    });

    const decision = db.prepare('SELECT * FROM review_decisions WHERE id = ?').get(decisionId);
    return { decision, touch: resolved, reused: false };
  });
}
