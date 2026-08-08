import { assertDecisionTransition } from '../domain/decision-request';
import { InvalidTransitionError } from '../domain/errors';
import type { DbLike } from '../domain/types';
import {
  insertDecisionRequest,
  getDecisionRequest,
  listDecisionRequests,
  updateDecisionRequestStatus,
  type CreateDecisionRequestInput,
  type DecisionRequestRow,
} from '../repositories/decision-requests';
import { projectTouch, resolveOpenTouchesForSource } from './touch-projection';
import { runTx } from './tx';

export type { CreateDecisionRequestInput, DecisionRequestRow };

export function createDecisionRequest(
  db: DbLike,
  input: CreateDecisionRequestInput
): DecisionRequestRow {
  return runTx(db, () => {
    const question = String(input.question || '').trim();
    if (!question) {
      throw new InvalidTransitionError('DecisionRequest.question is required');
    }
    const row = insertDecisionRequest(db, { ...input, question });
    projectTouch(db, {
      kind: 'decision_required',
      sourceType: 'decision_request',
      sourceId: row.id,
      sourceVersion: Number(row.version || 1),
      taskId: row.task_id,
      sourceEventId: row.id,
      openedSnapshot: {
        question: row.question,
        options: JSON.parse(row.options_json || '[]'),
      },
    });
    return row;
  });
}

export function getDecision(db: DbLike, id: string): DecisionRequestRow {
  return getDecisionRequest(db, id);
}

export function listDecisions(
  db: DbLike,
  filter: { status?: string; taskId?: string } = {}
): DecisionRequestRow[] {
  return listDecisionRequests(db, filter);
}

export function answerDecisionRequest(
  db: DbLike,
  id: string,
  response: unknown,
  expectedVersion?: number,
  actor = 'operator'
): DecisionRequestRow {
  return runTx(db, () => {
    const row = getDecisionRequest(db, id);
    assertDecisionTransition(row.status, 'answered');
    if (response == null) {
      throw new InvalidTransitionError('DecisionRequest answer requires a response payload');
    }
    const version = expectedVersion == null ? Number(row.version || 1) : Number(expectedVersion);
    const updated = updateDecisionRequestStatus(db, id, 'answered', version, response);
    resolveOpenTouchesForSource(db, 'decision_request', id, {
      resolvedBy: actor,
      resolutionEventId: id,
    });
    return updated;
  });
}

export function cancelDecisionRequest(
  db: DbLike,
  id: string,
  expectedVersion?: number,
  actor = 'operator'
): DecisionRequestRow {
  return runTx(db, () => {
    const row = getDecisionRequest(db, id);
    assertDecisionTransition(row.status, 'cancelled');
    const version = expectedVersion == null ? Number(row.version || 1) : Number(expectedVersion);
    const updated = updateDecisionRequestStatus(db, id, 'cancelled', version, null);
    resolveOpenTouchesForSource(db, 'decision_request', id, {
      resolvedBy: actor,
      resolutionEventId: id,
    });
    return updated;
  });
}
