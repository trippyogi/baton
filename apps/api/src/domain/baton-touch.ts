import { InvalidTransitionError } from './errors';

export const BATON_TOUCH_KINDS = [
  'review_required',
  'blocker_resolution_required',
  'decision_required',
  'assignment_required',
  'prioritization_required',
  'capture_triage_required',
] as const;

export type BatonTouchKind = (typeof BATON_TOUCH_KINDS)[number];

export const BATON_TOUCH_STATUSES = [
  'open',
  'snoozed',
  'resolved',
  'superseded',
  'cancelled',
] as const;

export type BatonTouchStatus = (typeof BATON_TOUCH_STATUSES)[number];

export const TERMINAL_TOUCH_STATUSES: ReadonlySet<BatonTouchStatus> = new Set([
  'resolved',
  'superseded',
  'cancelled',
]);

export const BATON_TOUCH_SOURCE_TYPES = [
  'review_packet',
  'task_blocker',
  'decision_request',
  'task_assignment',
  'task_prioritization',
  'triage_task',
] as const;

export type BatonTouchSourceType = (typeof BATON_TOUCH_SOURCE_TYPES)[number];

export const KIND_WEIGHTS: Record<BatonTouchKind, number> = {
  review_required: 10,
  blocker_resolution_required: 9,
  decision_required: 8,
  assignment_required: 6,
  prioritization_required: 5,
  capture_triage_required: 4,
};

export function makeDedupeKey(
  sourceType: BatonTouchSourceType | string,
  sourceId: string,
  sourceVersion: number
): string {
  return `${sourceType}:${sourceId}:v${sourceVersion}`;
}

export function assertTouchAttentionStatus(
  fromRaw: string,
  toRaw: string
): BatonTouchStatus {
  const from = fromRaw as BatonTouchStatus;
  const to = toRaw as BatonTouchStatus;
  if (!(BATON_TOUCH_STATUSES as readonly string[]).includes(from)) {
    throw new InvalidTransitionError(`Unknown touch status: ${from}`, { from, to });
  }
  if (!(BATON_TOUCH_STATUSES as readonly string[]).includes(to)) {
    throw new InvalidTransitionError(`Unknown touch status: ${to}`, { from, to });
  }
  if (TERMINAL_TOUCH_STATUSES.has(from)) {
    throw new InvalidTransitionError(`Terminal touch status ${from} is immutable`, { from, to });
  }
  const allowed: Record<BatonTouchStatus, readonly BatonTouchStatus[]> = {
    open: ['snoozed', 'resolved', 'superseded', 'cancelled'],
    snoozed: ['open', 'resolved', 'superseded', 'cancelled'],
    resolved: [],
    superseded: [],
    cancelled: [],
  };
  if (from === to) return to;
  if (!allowed[from].includes(to)) {
    throw new InvalidTransitionError(`Touch transition ${from} → ${to} is not allowed`, {
      from,
      to,
    });
  }
  return to;
}

/** Legacy Flow type → canonical kind (design §4.2). */
export const LEGACY_FLOW_TYPE_TO_KIND: Record<string, BatonTouchKind | null> = {
  review: 'review_required',
  blocker: 'blocker_resolution_required',
  decide: 'decision_required',
  strategy: 'decision_required',
  delegate: 'assignment_required',
  idle_agent: 'assignment_required',
  capture: 'capture_triage_required',
  refine: null,
  stale_run: null,
};

export function kindToSourceType(kind: BatonTouchKind): BatonTouchSourceType {
  switch (kind) {
    case 'review_required':
      return 'review_packet';
    case 'blocker_resolution_required':
      return 'task_blocker';
    case 'decision_required':
      return 'decision_request';
    case 'assignment_required':
      return 'task_assignment';
    case 'prioritization_required':
      return 'task_prioritization';
    case 'capture_triage_required':
      return 'triage_task';
    default:
      return 'triage_task';
  }
}
