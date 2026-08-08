import { ConflictError, InvalidTransitionError } from '../domain/errors';
import { assertTaskTransition, normalizeTaskStatus } from '../domain/task-status';
import type { DbLike } from '../domain/types';
import {
  assertTaskVersion,
  getTask,
  setTaskCurrentRun,
  updateTaskStatus,
  type TaskRow,
} from '../repositories/tasks';
import { listNonTerminalRunsForTask } from '../repositories/runs';

export type TransitionTaskInput = {
  taskId: string;
  toStatus: string;
  expectedVersion?: number;
};

export function transitionTask(db: DbLike, input: TransitionTaskInput): TaskRow {
  const task = getTask(db, input.taskId);
  assertTaskVersion(task, input.expectedVersion);
  if (task.archived_at && input.toStatus !== String(task.status)) {
    throw new InvalidTransitionError('Archived tasks cannot change execution status', {
      taskId: task.id,
      archivedAt: task.archived_at,
    });
  }
  const next = assertTaskTransition(task.status, input.toStatus);
  const version = Number(task.version || 1);
  return updateTaskStatus(db, task.id, next, version);
}

export type ArchiveTaskInput = {
  taskId: string;
  expectedVersion?: number;
  archive?: boolean;
};

export function setTaskArchived(db: DbLike, input: ArchiveTaskInput): TaskRow {
  const task = getTask(db, input.taskId);
  assertTaskVersion(task, input.expectedVersion);
  const archive = input.archive !== false;
  if (archive) {
    const active = listNonTerminalRunsForTask(db, task.id);
    if (active.length > 0) {
      throw new ConflictError('Cannot archive task with a non-terminal run', {
        taskId: task.id,
        activeRunIds: active.map((r) => r.id),
      });
    }
    const normalized = normalizeTaskStatus(task.status);
    if (['in_progress', 'blocked', 'human_review'].includes(normalized)) {
      throw new ConflictError('Cannot archive an active task; cancel or complete first', {
        taskId: task.id,
        status: task.status,
        normalizedStatus: normalized,
      });
    }
  }
  const updatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const archivedAt = archive ? updatedAt : null;
  const version = Number(task.version || 1);
  const result = db
    .prepare(
      `UPDATE tasks
       SET archived_at = ?, version = version + 1, updated_at = ?
       WHERE id = ? AND version = ?`
    )
    .run(archivedAt, updatedAt, task.id, version);
  if (!result.changes) {
    throw new ConflictError('Task version conflict on archive', {
      taskId: task.id,
      expectedVersion: version,
    });
  }
  return getTask(db, task.id);
}

export function bindCurrentRun(
  db: DbLike,
  taskId: string,
  runId: string | null,
  expectedVersion?: number
): TaskRow {
  const task = getTask(db, taskId);
  assertTaskVersion(task, expectedVersion);
  return setTaskCurrentRun(db, taskId, runId, Number(task.version || 1));
}
