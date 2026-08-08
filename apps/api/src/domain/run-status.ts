import { InvalidTransitionError } from './errors';

export const RUN_STATUSES = [
  'pending_dispatch',
  'dispatching',
  'dispatched',
  'acknowledged',
  'running',
  'validating_result',
  'cancelling',
  'completed',
  'blocked',
  'invalid_output',
  'dispatch_failed',
  'failed',
  'lost',
  'timed_out',
  'cancelled',
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export const TERMINAL_RUN_STATUSES: ReadonlySet<RunStatus> = new Set([
  'completed',
  'blocked',
  'invalid_output',
  'dispatch_failed',
  'failed',
  'lost',
  'timed_out',
  'cancelled',
]);

/** Legacy run statuses seen in Flow-era rows. */
export const LEGACY_RUN_STATUS_MAP: Record<string, RunStatus> = {
  pending: 'pending_dispatch',
  pending_dispatch: 'pending_dispatch',
  dispatching: 'dispatching',
  dispatched: 'dispatched',
  acknowledged: 'acknowledged',
  running: 'running',
  validating_result: 'validating_result',
  cancelling: 'cancelling',
  completed: 'completed',
  success: 'completed',
  succeeded: 'completed',
  blocked: 'blocked',
  invalid_output: 'invalid_output',
  dispatch_failed: 'dispatch_failed',
  failed: 'failed',
  error: 'failed',
  lost: 'lost',
  timed_out: 'timed_out',
  cancelled: 'cancelled',
};

/** Status strings that count as terminal in SQL filters (canonical + legacy aliases). */
export const SQL_TERMINAL_RUN_STATUSES = [
  ...TERMINAL_RUN_STATUSES,
  'success',
  'succeeded',
  'error',
] as const;

const ALLOWED: Record<RunStatus, readonly RunStatus[]> = {
  pending_dispatch: ['dispatching', 'cancelled', 'dispatch_failed'],
  dispatching: ['dispatched', 'dispatch_failed', 'cancelled'],
  dispatched: ['acknowledged', 'dispatch_failed', 'timed_out', 'cancelled'],
  acknowledged: ['running', 'cancelled', 'lost'],
  running: ['validating_result', 'cancelling', 'blocked', 'failed', 'lost', 'timed_out', 'cancelled'],
  validating_result: ['completed', 'invalid_output', 'blocked', 'failed', 'cancelled'],
  cancelling: ['cancelled', 'failed'],
  completed: [],
  blocked: [],
  invalid_output: [],
  dispatch_failed: [],
  failed: [],
  lost: [],
  timed_out: [],
  cancelled: [],
};

export function normalizeRunStatus(status: string | null | undefined): RunStatus {
  const raw = String(status || 'pending_dispatch');
  if ((RUN_STATUSES as readonly string[]).includes(raw)) return raw as RunStatus;
  const mapped = LEGACY_RUN_STATUS_MAP[raw];
  if (mapped) return mapped;
  throw new InvalidTransitionError(`Unknown run status: ${raw}`, { status: raw });
}

export function isTerminalRunStatus(status: string): boolean {
  return TERMINAL_RUN_STATUSES.has(normalizeRunStatus(status));
}

export function assertRunTransition(fromRaw: string, toRaw: string): RunStatus {
  const from = normalizeRunStatus(fromRaw);
  const to = normalizeRunStatus(toRaw);
  if (TERMINAL_RUN_STATUSES.has(from)) {
    throw new InvalidTransitionError(`Terminal run status ${from} is immutable`, { from, to });
  }
  if (from === to) return to;
  if (!ALLOWED[from].includes(to)) {
    throw new InvalidTransitionError(`Run transition ${from} → ${to} is not allowed`, { from, to });
  }
  // ACK required before running.
  if (to === 'running' && from !== 'acknowledged' && from !== 'running') {
    throw new InvalidTransitionError('Run cannot enter running without ACK (acknowledged)', {
      from,
      to,
    });
  }
  return to;
}
