import { InvalidTransitionError } from './errors';

export const DECISION_REQUEST_STATUSES = ['open', 'answered', 'cancelled'] as const;
export type DecisionRequestStatus = (typeof DECISION_REQUEST_STATUSES)[number];

export const TERMINAL_DECISION_STATUSES: ReadonlySet<DecisionRequestStatus> = new Set([
  'answered',
  'cancelled',
]);

const ALLOWED: Record<DecisionRequestStatus, readonly DecisionRequestStatus[]> = {
  open: ['answered', 'cancelled'],
  answered: [],
  cancelled: [],
};

export function assertDecisionTransition(
  fromRaw: string,
  toRaw: string
): DecisionRequestStatus {
  const from = fromRaw as DecisionRequestStatus;
  const to = toRaw as DecisionRequestStatus;
  if (!(DECISION_REQUEST_STATUSES as readonly string[]).includes(from)) {
    throw new InvalidTransitionError(`Unknown decision status: ${from}`, { from, to });
  }
  if (!(DECISION_REQUEST_STATUSES as readonly string[]).includes(to)) {
    throw new InvalidTransitionError(`Unknown decision status: ${to}`, { from, to });
  }
  if (from === to) return to;
  if (TERMINAL_DECISION_STATUSES.has(from)) {
    throw new InvalidTransitionError(`Terminal decision status ${from} is immutable`, { from, to });
  }
  if (!ALLOWED[from].includes(to)) {
    throw new InvalidTransitionError(`Decision transition ${from} → ${to} is not allowed`, {
      from,
      to,
    });
  }
  return to;
}
