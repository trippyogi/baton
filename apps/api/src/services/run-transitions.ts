import { ConflictError, InvalidTransitionError } from '../domain/errors';
import {
  assertRunTransition,
  isTerminalRunStatus,
  normalizeRunStatus,
} from '../domain/run-status';
import type { DbLike } from '../domain/types';
import { nowIso } from '../domain/types';
import {
  assertRunVersion,
  findChildRun,
  getRun,
  insertChildRun,
  listNonTerminalRunsForTask,
  updateRunStatus,
  type RunRow,
} from '../repositories/runs';
import { getTask, setTaskCurrentRun } from '../repositories/tasks';

function runTx<T>(db: DbLike, fn: () => T): T {
  if (typeof db.transaction === 'function') {
    return db.transaction(fn)();
  }
  return fn();
}

export type TransitionRunInput = {
  runId: string;
  toStatus: string;
  expectedVersion?: number;
  resultKind?: string | null;
  failureMessage?: string | null;
};

export function transitionRun(db: DbLike, input: TransitionRunInput): RunRow {
  return runTx(db, () => {
    const run = getRun(db, input.runId);
    assertRunVersion(run, input.expectedVersion);
    const from = normalizeRunStatus(run.status);
    const next = assertRunTransition(run.status, input.toStatus);
    if (from === next) return run;
    const endedAt = isTerminalRunStatus(next) ? nowIso() : null;
    return updateRunStatus(db, run.id, next, Number(run.version || 1), {
      endedAt,
      resultKind: input.resultKind ?? null,
      failureMessage: input.failureMessage ?? null,
    });
  });
}

export type CreateChildRunInput = {
  parentRunId: string;
  expectedParentVersion?: number;
  kind?: string;
  /** When true, parent must already be terminal (default). */
  requireTerminalParent?: boolean;
  /** Terminal status to apply to parent if still non-terminal (e.g. invalid_output). */
  parentTerminalStatus?: string;
};

/**
 * Create exactly one child run (linear lineage) and point the task at it.
 * Enforces: terminal parent (or transitions parent), no existing child, ≤1 active run.
 */
export function createChildRun(db: DbLike, input: CreateChildRunInput): {
  parent: RunRow;
  child: RunRow;
} {
  return runTx(db, () => {
    let parent = getRun(db, input.parentRunId);
    assertRunVersion(parent, input.expectedParentVersion);

    const existingChild = findChildRun(db, parent.id);
    if (existingChild) {
      throw new ConflictError('Linear lineage violated: parent already has a child run', {
        parentRunId: parent.id,
        childRunId: existingChild.id,
      });
    }

    if (!isTerminalRunStatus(parent.status)) {
      if (input.requireTerminalParent !== false && !input.parentTerminalStatus) {
        throw new InvalidTransitionError(
          'Child runs require a terminal parent (or parentTerminalStatus)',
          { parentRunId: parent.id, status: parent.status }
        );
      }
      const terminal = assertRunTransition(
        parent.status,
        input.parentTerminalStatus || 'cancelled'
      );
      parent = updateRunStatus(db, parent.id, terminal, Number(parent.version || 1), {
        endedAt: nowIso(),
        resultKind: terminal,
      });
    }

    if (!parent.task_id) {
      throw new InvalidTransitionError('Child run requires parent.task_id', {
        parentRunId: parent.id,
      });
    }

    const active = listNonTerminalRunsForTask(db, parent.task_id).filter((r) => r.id !== parent.id);
    if (active.length > 0) {
      throw new ConflictError('Task already has a non-terminal run', {
        taskId: parent.task_id,
        activeRunIds: active.map((r) => r.id),
      });
    }

    const child = insertChildRun(db, parent, { kind: input.kind });
    const task = getTask(db, parent.task_id);
    setTaskCurrentRun(db, task.id, child.id, Number(task.version || 1));
    return { parent: getRun(db, parent.id), child };
  });
}

export function assertOneActiveRun(db: DbLike, taskId: string, ignoreRunId?: string): void {
  const active = listNonTerminalRunsForTask(db, taskId).filter((r) => r.id !== ignoreRunId);
  if (active.length > 1) {
    throw new ConflictError('Task has multiple non-terminal runs', {
      taskId,
      activeRunIds: active.map((r) => r.id),
    });
  }
}

export function acknowledgeRun(db: DbLike, runId: string, expectedVersion?: number): RunRow {
  const run = getRun(db, runId);
  const from = normalizeRunStatus(run.status);
  if (from === 'acknowledged' || from === 'running') return run;
  return transitionRun(db, {
    runId,
    toStatus: 'acknowledged',
    expectedVersion,
  });
}
