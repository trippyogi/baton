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

export type { CreateDecisionRequestInput, DecisionRequestRow };

export function createDecisionRequest(
  db: DbLike,
  input: CreateDecisionRequestInput
): DecisionRequestRow {
  const question = String(input.question || '').trim();
  if (!question) {
    throw new InvalidTransitionError('DecisionRequest.question is required');
  }
  return insertDecisionRequest(db, { ...input, question });
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
  expectedVersion?: number
): DecisionRequestRow {
  const row = getDecisionRequest(db, id);
  assertDecisionTransition(row.status, 'answered');
  if (response == null) {
    throw new InvalidTransitionError('DecisionRequest answer requires a response payload');
  }
  const version = expectedVersion == null ? Number(row.version || 1) : Number(expectedVersion);
  return updateDecisionRequestStatus(db, id, 'answered', version, response);
}

export function cancelDecisionRequest(
  db: DbLike,
  id: string,
  expectedVersion?: number
): DecisionRequestRow {
  const row = getDecisionRequest(db, id);
  assertDecisionTransition(row.status, 'cancelled');
  const version = expectedVersion == null ? Number(row.version || 1) : Number(expectedVersion);
  return updateDecisionRequestStatus(db, id, 'cancelled', version, null);
}
