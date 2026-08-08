import { Router } from 'express';
import type { Request, Response } from 'express';

type Stmt = {
  get: (...params: unknown[]) => Record<string, unknown> | undefined;
  run: (...params: unknown[]) => unknown;
};

type DbLike = {
  prepare: (sql: string) => Stmt;
};

type DispatchShape = {
  enabled: boolean;
  transport: unknown;
  target: unknown;
  url: unknown;
  token: unknown;
  timeoutMs: unknown;
};

type DispatchDeps = {
  db: DbLike;
  id: (prefix: string) => string;
  loadSettings: (db: DbLike) => unknown;
  buildDispatchEnvelope: (input: Record<string, unknown>) => unknown;
  resolveDispatch: (agent: Record<string, unknown>) => DispatchShape;
  dispatchRun: (input: { db: DbLike; runId: string; intent: string }) => Promise<unknown>;
  publicBaseUrl: () => string;
};

function safeDispatch(dispatch: DispatchShape): Record<string, unknown> {
  return {
    enabled: dispatch.enabled,
    transport: dispatch.transport,
    target: dispatch.target,
    url_configured: Boolean(dispatch.url),
    token_configured: Boolean(dispatch.token),
    timeout_ms: dispatch.timeoutMs,
  };
}

export function createDispatchRouter(deps: DispatchDeps): Router {
  const {
    db, id, loadSettings, buildDispatchEnvelope, resolveDispatch, dispatchRun, publicBaseUrl,
  } = deps;
  const router = Router();

  router.post('/test', async (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      const agentId = (body.agent_id as string) || 'spectre';
      const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
      if (!agent) return res.status(404).json({ error: `unknown agent_id: ${agentId}` });
      const task = body.task_id
        ? db.prepare('SELECT * FROM tasks WHERE id = ?').get(String(body.task_id))
        : {
          id: 'dry_task',
          title: body.title || 'Evaluate example launch sequence',
          description: body.description || '',
          priority: 'high',
          domain: 'revenue',
          project_key: 'launch-demo',
          risk_level: 'medium',
          autonomy_level: 3,
        };
      if (!task) return res.status(404).json({ error: `unknown task_id: ${body.task_id}` });
      const touch = body.touch_id
        ? db.prepare('SELECT * FROM flow_touches WHERE id = ?').get(String(body.touch_id))
        : {
          id: 'dry_touch',
          title: task.title,
          description: task.description,
          domain: task.domain,
          project_key: task.project_key,
          risk_level: task.risk_level,
          autonomy_level: task.autonomy_level,
        };
      if (!touch) return res.status(404).json({ error: `unknown touch_id: ${body.touch_id}` });
      const run = {
        id: body.run_id || 'dry_run',
        task_id: task.id,
        touch_id: touch.id,
        agent_id: agent.id,
      };
      const envelope = buildDispatchEnvelope({
        run,
        task,
        touch,
        agent,
        settings: loadSettings(db),
        baseUrl: publicBaseUrl(),
        intent: body.intent || 'orchestrate',
      });
      const dispatch = resolveDispatch(agent);
      if (body.dry_run !== false) {
        return res.json({ dry_run: true, envelope, dispatch: safeDispatch(dispatch) });
      }

      if (!body.task_id || !body.touch_id) {
        return res.status(400).json({ error: 'live test requires task_id and touch_id' });
      }
      const runId = id('run');
      db.prepare(`
      INSERT INTO runs (id, agent_name, worker_type, status, task_id, touch_id, agent_id, dispatch_status, dispatch_transport, dispatch_target, steps, logs)
      VALUES (?, ?, ?, 'pending_dispatch', ?, ?, ?, 'queued', ?, ?, '[]', '[]')
    `).run(
        runId,
        agent.name,
        agent.type,
        task.id,
        touch.id,
        agent.id,
        dispatch.transport,
        dispatch.target || null,
      );
      const result = await dispatchRun({ db, runId, intent: String(body.intent || 'orchestrate') });
      res.status(201).json(result);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'dispatch test failed' });
    }
  });

  return router;
}
