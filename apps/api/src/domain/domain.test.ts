import { describe, expect, it } from 'vitest';
import {
  assertTaskTransition,
  isTerminalTaskStatus,
  normalizeTaskStatus,
} from './task-status';
import {
  assertRunTransition,
  isTerminalRunStatus,
  normalizeRunStatus,
} from './run-status';
import { assertDecisionTransition } from './decision-request';
import { InvalidTransitionError } from './errors';

describe('task-status', () => {
  it('maps legacy statuses and allows ready → in_progress', () => {
    expect(normalizeTaskStatus('inbox')).toBe('triage');
    expect(assertTaskTransition('ready', 'in_progress')).toBe('in_progress');
  });

  it('rejects terminal reopen', () => {
    expect(() => assertTaskTransition('done', 'ready')).toThrow(InvalidTransitionError);
    expect(isTerminalTaskStatus('cancelled')).toBe(true);
  });
});

describe('run-status', () => {
  it('requires ACK before running', () => {
    expect(normalizeRunStatus('pending')).toBe('pending_dispatch');
    expect(() => assertRunTransition('dispatched', 'running')).toThrow(InvalidTransitionError);
    expect(assertRunTransition('acknowledged', 'running')).toBe('running');
  });

  it('rejects terminal reopen', () => {
    expect(() => assertRunTransition('completed', 'running')).toThrow(InvalidTransitionError);
    expect(isTerminalRunStatus('failed')).toBe(true);
  });
});

describe('decision-request status', () => {
  it('allows open → answered|cancelled only', () => {
    expect(assertDecisionTransition('open', 'answered')).toBe('answered');
    expect(assertDecisionTransition('open', 'cancelled')).toBe('cancelled');
    expect(() => assertDecisionTransition('answered', 'open')).toThrow(InvalidTransitionError);
  });
});
