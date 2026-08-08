import { ConflictError, InvalidTransitionError, NotFoundError } from '../domain/errors';
import type { DbLike } from '../domain/types';
import { newId, nowIso } from '../domain/types';
import { projectTouch, resolveOpenTouchesForSource } from './touch-projection';
import { transitionTask } from './task-transitions';
import { runTx } from './tx';

export type CreateBlockerInput = {
  taskId: string;
  reasonCode: string;
  summary: string;
  runId?: string | null;
  questions?: unknown;
  sourcePacketId?: string | null;
};

export function createTaskBlocker(db: DbLike, input: CreateBlockerInput) {
  return runTx(db, () => {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(input.taskId) as
      | Record<string, unknown>
      | undefined;
    if (!task) throw new NotFoundError(`Task not found: ${input.taskId}`);
    if (!String(input.reasonCode || '').trim() || !String(input.summary || '').trim()) {
      throw new InvalidTransitionError('Blocker reasonCode and summary are required');
    }

    const id = newId('blocker');
    const now = nowIso();
    db.prepare(
      `INSERT INTO task_blockers (
         id, task_id, run_id, source_packet_id, reason_code, summary, questions_json,
         status, version, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', 1, ?)`
    ).run(
      id,
      input.taskId,
      input.runId ?? null,
      input.sourcePacketId ?? null,
      input.reasonCode,
      input.summary,
      JSON.stringify(input.questions ?? []),
      now
    );

    transitionTask(db, { taskId: input.taskId, toStatus: 'blocked' });

    const touch = projectTouch(db, {
      kind: 'blocker_resolution_required',
      sourceType: 'task_blocker',
      sourceId: id,
      sourceVersion: 1,
      taskId: input.taskId,
      runId: input.runId,
      sourceEventId: id,
      impact: Number(task.impact_score ?? 5),
      urgency: Number((task as { urgency?: number }).urgency ?? 5),
      effort: Number(task.effort_score ?? 5),
      openedSnapshot: {
        reasonCode: input.reasonCode,
        summary: input.summary,
      },
    });

    const blocker = db.prepare('SELECT * FROM task_blockers WHERE id = ?').get(id);
    return { blocker, touch };
  });
}

export function resolveTaskBlocker(
  db: DbLike,
  blockerId: string,
  opts: { expectedVersion?: number; resolutionNote?: string | null; actor?: string } = {}
) {
  return runTx(db, () => {
    const blocker = db.prepare('SELECT * FROM task_blockers WHERE id = ?').get(blockerId) as
      | Record<string, unknown>
      | undefined;
    if (!blocker) throw new NotFoundError(`Blocker not found: ${blockerId}`);
    if (String(blocker.status) !== 'open') {
      throw new ConflictError('Blocker is not open', { blockerId, status: blocker.status });
    }
    if (
      opts.expectedVersion != null &&
      Number(blocker.version || 1) !== Number(opts.expectedVersion)
    ) {
      throw new ConflictError('Blocker version conflict', {
        blockerId,
        expectedVersion: opts.expectedVersion,
      });
    }

    const now = nowIso();
    db.prepare(
      `UPDATE task_blockers
       SET status = 'resolved',
           resolution_note = ?,
           resolved_at = ?,
           version = version + 1
       WHERE id = ?`
    ).run(opts.resolutionNote ?? null, now, blockerId);

    const remainingOpen = db
      .prepare(
        `SELECT COUNT(*) AS n FROM task_blockers
         WHERE task_id = ? AND status = 'open' AND id <> ?`
      )
      .get(String(blocker.task_id), blockerId) as { n: number };
    if (Number(remainingOpen?.n || 0) === 0) {
      transitionTask(db, { taskId: String(blocker.task_id), toStatus: 'ready' });
    }

    const touches = resolveOpenTouchesForSource(db, 'task_blocker', blockerId, {
      resolvedBy: opts.actor || 'operator',
      resolutionEventId: blockerId,
    });

    const updated = db.prepare('SELECT * FROM task_blockers WHERE id = ?').get(blockerId);
    return { blocker: updated, touches };
  });
}
