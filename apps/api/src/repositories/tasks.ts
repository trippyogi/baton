import { ConflictError, NotFoundError } from '../domain/errors';
import type { DbLike } from '../domain/types';
import { nowIso } from '../domain/types';

export type TaskRow = {
  id: string;
  title: string;
  status: string;
  version: number;
  archived_at: string | null;
  current_run_id: string | null;
  objective?: string;
};

export function getTask(db: DbLike, taskId: string): TaskRow {
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow | undefined;
  if (!row) throw new NotFoundError(`Task not found: ${taskId}`, { taskId });
  return row;
}

export function assertTaskVersion(task: TaskRow, expectedVersion: number | undefined): void {
  if (expectedVersion == null) return;
  if (Number(task.version || 1) !== Number(expectedVersion)) {
    throw new ConflictError('Task version conflict', {
      taskId: task.id,
      expectedVersion,
      actualVersion: task.version,
    });
  }
}

export function updateTaskStatus(
  db: DbLike,
  taskId: string,
  status: string,
  expectedVersion: number
): TaskRow {
  const updatedAt = nowIso();
  const result = db
    .prepare(
      `UPDATE tasks
       SET status = ?, version = version + 1, updated_at = ?
       WHERE id = ? AND version = ?`
    )
    .run(status, updatedAt, taskId, expectedVersion);
  if (!result.changes) {
    throw new ConflictError('Task version conflict on update', { taskId, expectedVersion });
  }
  return getTask(db, taskId);
}

export function setTaskCurrentRun(
  db: DbLike,
  taskId: string,
  runId: string | null,
  expectedVersion: number
): TaskRow {
  const updatedAt = nowIso();
  const result = db
    .prepare(
      `UPDATE tasks
       SET current_run_id = ?, version = version + 1, updated_at = ?
       WHERE id = ? AND version = ?`
    )
    .run(runId, updatedAt, taskId, expectedVersion);
  if (!result.changes) {
    throw new ConflictError('Task version conflict on current_run_id update', {
      taskId,
      expectedVersion,
    });
  }
  return getTask(db, taskId);
}
