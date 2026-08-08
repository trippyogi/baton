import { InvalidTransitionError } from './errors';

export const TASK_STATUSES = [
  'triage',
  'ready',
  'in_progress',
  'blocked',
  'human_review',
  'done',
  'cancelled',
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TERMINAL_TASK_STATUSES: ReadonlySet<TaskStatus> = new Set(['done', 'cancelled']);

/** Map legacy Flow/task statuses onto the canonical machine during the compatibility window. */
export const LEGACY_TASK_STATUS_MAP: Record<string, TaskStatus> = {
  inbox: 'triage',
  backlog: 'triage',
  triage: 'triage',
  ready: 'ready',
  prepared: 'ready',
  in_progress: 'in_progress',
  airborne: 'in_progress',
  waiting: 'blocked',
  blocked: 'blocked',
  review: 'human_review',
  human_review: 'human_review',
  done: 'done',
  completed: 'done',
  cancelled: 'cancelled',
  archived: 'cancelled',
};

const ALLOWED: Record<TaskStatus, readonly TaskStatus[]> = {
  triage: ['ready', 'cancelled'],
  ready: ['in_progress', 'cancelled'],
  in_progress: ['blocked', 'human_review', 'cancelled', 'done'],
  blocked: ['ready', 'in_progress', 'cancelled'],
  human_review: ['in_progress', 'done', 'cancelled'],
  done: [],
  cancelled: [],
};

export function normalizeTaskStatus(status: string | null | undefined): TaskStatus {
  const raw = String(status || 'triage');
  if ((TASK_STATUSES as readonly string[]).includes(raw)) return raw as TaskStatus;
  const mapped = LEGACY_TASK_STATUS_MAP[raw];
  if (mapped) return mapped;
  throw new InvalidTransitionError(`Unknown task status: ${raw}`, { status: raw });
}

export function isTerminalTaskStatus(status: string): boolean {
  return TERMINAL_TASK_STATUSES.has(normalizeTaskStatus(status));
}

export function assertTaskTransition(fromRaw: string, toRaw: string): TaskStatus {
  const from = normalizeTaskStatus(fromRaw);
  const to = normalizeTaskStatus(toRaw);
  if (TERMINAL_TASK_STATUSES.has(from)) {
    throw new InvalidTransitionError(`Terminal task status ${from} is immutable`, { from, to });
  }
  if (from === to) return to;
  if (!ALLOWED[from].includes(to)) {
    throw new InvalidTransitionError(`Task transition ${from} → ${to} is not allowed`, { from, to });
  }
  return to;
}
