import { Router } from 'express';
import type { Request, Response } from 'express';
import { listAttentionTouches } from '../repositories/baton-touches';
import { mergeCanonicalAndLegacyTouches } from '../adapters/flow-touch-map';
import type { BatonTouchRow } from '../repositories/baton-touches';

type Stmt = {
  all: (...params: unknown[]) => unknown[];
  get: (...params: unknown[]) => Record<string, unknown> | undefined;
  run: (...params: unknown[]) => unknown;
};

type DbLike = {
  prepare: (sql: string) => Stmt;
  transaction: <T>(fn: () => T) => () => T;
};

type TouchesDeps = {
  db: DbLike;
  id: (prefix: string) => string;
  stringifyJson: (value: unknown) => string;
  sqliteDateTimeAfterMs: (ms: number) => string;
  toSqliteDateTime: (date?: Date) => string;
  isActionAllowed: (type: unknown, action: unknown) => boolean;
  rebuildTouches: (db: DbLike) => unknown;
  parseTouch: (row: Record<string, unknown>) => Record<string, unknown>;
  rankOpenTouches: (db: DbLike) => unknown;
  markDomainTouched: (db: DbLike, domain: unknown) => unknown;
  dispatchRun: (input: {
    db: DbLike;
    runId: string;
    intent: string;
    instructions: string[];
  }) => Promise<{
    run?: unknown;
    dispatch_status?: unknown;
    message?: unknown;
    error?: unknown;
  }>;
};

function eventName(action: string): string {
  return ({
    accept: 'accepted',
    refine: 'refined',
    delegate: 'delegated',
    assign: 'delegated',
    answer: 'resolved',
    send_to_evaluator: 'delegated',
    snooze: 'snoozed',
    archive: 'archived',
    process: 'resolved',
    inspect: 'opened',
    escalate: 'escalated',
  } as Record<string, string>)[action] || action;
}

export function createTouchesRouter(deps: TouchesDeps): Router {
  const {
    db, id, stringifyJson, sqliteDateTimeAfterMs, toSqliteDateTime,
    isActionAllowed, rebuildTouches, parseTouch, rankOpenTouches,
    markDomainTouched, dispatchRun,
  } = deps;
  const router = Router();

  function defaultSnooze(): string {
    return sqliteDateTimeAfterMs(60 * 60 * 1000);
  }

  function normalizeSnooze(value: unknown): string | null {
    if (!value) return null;
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) return null;
    return toSqliteDateTime(date);
  }

  function instructionsFromBody(body: Record<string, unknown>): string[] {
    const text = body.instructions || body.feedback || '';
    if (!text) return [];
    return Array.isArray(text) ? text.map(String) : [String(text)];
  }

  function resolveAgent(
    touch: Record<string, unknown>,
    body: Record<string, unknown>,
    action: string,
  ): Record<string, unknown> | null {
    const ids = [touch.agent_id, body.agent_id].filter(Boolean) as unknown[];
    if (action === 'send_to_evaluator') ids.push('evaluator-agent', 'spectre');
    if (touch.task_id) {
      const task = db.prepare('SELECT owner FROM tasks WHERE id = ?').get(String(touch.task_id));
      if (task?.owner) ids.push(task.owner);
    }
    ids.push('spectre');
    for (const agentId of ids) {
      const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(String(agentId));
      if (agent) return agent;
    }
    return db.prepare(`SELECT * FROM agents WHERE status = 'idle' AND dispatch_enabled = 1 ORDER BY name LIMIT 1`).get() || null;
  }

  function completeLinkedRun(touch: Record<string, unknown>): void {
    let runId = touch.run_id as string | null | undefined;
    if (!runId && touch.review_packet_id) {
      const packet = db.prepare('SELECT run_id FROM review_packets WHERE id = ?').get(String(touch.review_packet_id));
      runId = (packet?.run_id as string) || null;
    }
    if (!runId) return;
    const run = db.prepare('SELECT agent_id FROM runs WHERE id = ?').get(runId);
    db.prepare(`UPDATE runs SET status = 'completed', ended_at = datetime('now'), last_status_at = datetime('now') WHERE id = ?`).run(runId);
    if (run?.agent_id) {
      db.prepare(`UPDATE agents SET status = 'idle', current_task_id = NULL, current_run_id = NULL, updated_at = datetime('now') WHERE id = ?`).run(run.agent_id);
    }
  }

  function createDispatchRun(
    touch: Record<string, unknown>,
    body: Record<string, unknown>,
    action: string,
  ): string {
    const task = touch.task_id ? db.prepare('SELECT * FROM tasks WHERE id = ?').get(String(touch.task_id)) : null;
    const agent = resolveAgent(touch, body, action);
    const runId = id('run');
    const agentName = agent?.name || body.agent_name || 'manual';
    const workerType = agent?.type || null;
    const transport = agent?.dispatch_transport || 'manual';
    const target = agent?.dispatch_target || null;
    const tx = db.transaction(() => {
      db.prepare(`
      INSERT INTO runs (
        id, agent_name, worker_type, status, task_id, touch_id, agent_id,
        dispatch_status, dispatch_transport, dispatch_target, steps, logs, created_at
      ) VALUES (?, ?, ?, 'pending_dispatch', ?, ?, ?, 'queued', ?, ?, '[]', '[]', datetime('now'))
    `).run(runId, agentName, workerType, task?.id || null, touch.id, agent?.id || null, transport, target);
      db.prepare(`INSERT INTO touch_events (id, touch_id, event_type, actor, payload) VALUES (?, ?, ?, 'human', ?)`).run(
        id('event'),
        touch.id,
        eventName(action),
        stringifyJson({
          action,
          run_id: runId,
          agent_id: agent?.id || null,
          instructions: body.instructions || body.feedback || '',
        }),
      );
      markDomainTouched(db, touch.domain);
    });
    tx();
    return runId;
  }

  router.get('/', (req: Request, res: Response) => {
    try {
      let sql = 'SELECT * FROM flow_touches WHERE 1=1';
      const params: unknown[] = [];
      if (typeof req.query.status === 'string') { sql += ' AND status = ?'; params.push(req.query.status); }
      if (typeof req.query.type === 'string') { sql += ' AND type = ?'; params.push(req.query.type); }
      if (typeof req.query.domain === 'string') { sql += ' AND domain = ?'; params.push(req.query.domain); }
      if (typeof req.query.project_key === 'string') { sql += ' AND project_key = ?'; params.push(req.query.project_key); }
      if (req.query.include_archived !== 'true') sql += " AND status NOT IN ('archived', 'resolved')";
      sql += ' ORDER BY score DESC, created_at ASC LIMIT ?';
      const limit = Number(req.query.limit || 50);
      params.push(limit);
      const legacy = db.prepare(sql).all(...params).map((row) =>
        parseTouch(row as Record<string, unknown>)
      );
      let canonical: BatonTouchRow[] = [];
      // Only merge canonical when not filtering to a Flow-only facet or non-open status.
      const statusFilter =
        typeof req.query.status === 'string' ? String(req.query.status) : '';
      const statusAllowsCanonical =
        !statusFilter || statusFilter === 'pending' || statusFilter === 'snoozed';
      if (
        statusAllowsCanonical &&
        !req.query.type &&
        !req.query.domain &&
        !req.query.project_key
      ) {
        try {
          canonical = listAttentionTouches(db as never, {
            includeSnoozed: statusFilter !== 'pending',
            limit,
          });
          if (statusFilter === 'pending') {
            canonical = canonical.filter((t) => String(t.status) === 'open');
          } else if (statusFilter === 'snoozed') {
            canonical = canonical.filter((t) => String(t.status) === 'snoozed');
          }
        } catch (_) {
          canonical = [];
        }
      }
      res.json(mergeCanonicalAndLegacyTouches(canonical, legacy, limit));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'touches list failed' });
    }
  });

  router.post('/rebuild', (_req: Request, res: Response) => {
    try {
      res.json(rebuildTouches(db));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'touches rebuild failed' });
    }
  });

  router.patch('/:id/action', async (req: Request, res: Response) => {
    try {
      const touch = db.prepare('SELECT * FROM flow_touches WHERE id = ?').get(req.params.id);
      if (!touch) return res.status(404).json({ error: 'Not found' });
      const body = (req.body || {}) as Record<string, unknown>;
      const action = body.action;
      if (!action) return res.status(400).json({ error: 'action is required' });
      if (!isActionAllowed(touch.type, action)) {
        return res.status(400).json({
          error: `action ${action} is not allowed for touch type ${touch.type}`,
          touch_type: touch.type,
          action,
        });
      }

      if (['delegate', 'assign', 'send_to_evaluator'].includes(String(action))) {
        const runId = createDispatchRun(touch, body, String(action));
        const result = await dispatchRun({
          db,
          runId,
          intent: action === 'send_to_evaluator' ? 'evaluate' : 'orchestrate',
          instructions: instructionsFromBody(body),
        });
        const updatedTouch = parseTouch(db.prepare('SELECT * FROM flow_touches WHERE id = ?').get(String(touch.id)) as Record<string, unknown>);
        const updatedTask = touch.task_id
          ? db.prepare('SELECT * FROM tasks WHERE id = ?').get(String(touch.task_id))
          : null;
        return res.json({
          touch: updatedTouch,
          task: updatedTask,
          run: result.run,
          dispatch_status: result.dispatch_status,
          message: result.message,
          error: result.error || null,
        });
      }

      const tx = db.transaction(() => {
        const eventId = id('event');
        let touchStatus = touch.status as string;
        let taskStatus: string | null = null;
        let message = 'Touch updated.';
        let snoozedUntil: string | null = null;
        let resolvedAt: string | null = null;
        const dispatchStatus = null;

        if (action === 'accept') {
          touchStatus = 'resolved';
          taskStatus = body.update_task === false ? null : 'done';
          resolvedAt = toSqliteDateTime();
          completeLinkedRun(touch);
          message = taskStatus ? 'Accepted and marked task done.' : 'Accepted.';
        } else if (action === 'refine') {
          touchStatus = 'passed';
          taskStatus = body.update_task === false ? null : 'waiting';
          message = 'Feedback captured and task moved back for refinement.';
        } else if (action === 'answer') {
          touchStatus = 'passed';
          taskStatus = 'ready';
          message = 'Answer captured; task is ready to pass.';
        } else if (action === 'snooze') {
          touchStatus = 'snoozed';
          snoozedUntil = normalizeSnooze(body.until) || defaultSnooze();
          message = `Snoozed until ${snoozedUntil}.`;
        } else if (action === 'archive') {
          touchStatus = 'archived';
          message = 'Archived touch.';
        } else if (action === 'process') {
          touchStatus = 'resolved';
          taskStatus = (body.task_status as string) || 'ready';
          resolvedAt = toSqliteDateTime();
          message = 'Processed capture and made task ready.';
        } else if (action === 'inspect') {
          touchStatus = 'active';
          message = 'Marked for inspection.';
        } else if (action === 'escalate') {
          db.prepare(`
          UPDATE flow_touches
          SET manual_priority_boost = MIN(1.0, COALESCE(manual_priority_boost, 0) + 0.2),
              score = MIN(100, COALESCE(score, 0) + 4),
              updated_at = datetime('now')
          WHERE id = ?
        `).run(touch.id);
          message = 'Escalated touch priority.';
        }

        db.prepare(`
        UPDATE flow_touches
        SET status = ?, last_touched_at = datetime('now'), snoozed_until = ?, resolved_at = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(touchStatus, snoozedUntil, resolvedAt, touch.id);

        if (taskStatus && touch.task_id) {
          db.prepare(`UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(taskStatus, touch.task_id);
        }

        db.prepare(`INSERT INTO touch_events (id, touch_id, event_type, actor, payload) VALUES (?, ?, ?, 'human', ?)`).run(
          eventId,
          touch.id,
          eventName(String(action)),
          stringifyJson({
            feedback: body.feedback || '',
            instructions: body.instructions || '',
            reason: body.reason || '',
            dispatch_status: dispatchStatus,
          }),
        );

        if (['accept', 'process', 'archive', 'answer', 'refine'].includes(String(action))) {
          markDomainTouched(db, touch.domain);
        }
        if (taskStatus || ['archive', 'snooze', 'accept', 'process'].includes(String(action))) {
          rebuildTouches(db);
        } else {
          rankOpenTouches(db);
        }
        const updatedTouch = parseTouch(db.prepare('SELECT * FROM flow_touches WHERE id = ?').get(String(touch.id)) as Record<string, unknown>);
        const updatedTask = touch.task_id
          ? db.prepare('SELECT * FROM tasks WHERE id = ?').get(String(touch.task_id))
          : null;
        return {
          touch: updatedTouch,
          task: updatedTask,
          run: null,
          event_id: eventId,
          dispatch_status: dispatchStatus,
          message,
        };
      });

      res.json(tx());
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'touch action failed' });
    }
  });

  return router;
}
