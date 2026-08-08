import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';

type Stmt = {
  all: (...params: unknown[]) => unknown[];
  get: (...params: unknown[]) => Record<string, unknown> | undefined;
  run: (...params: unknown[]) => { changes?: number };
};

type DbLike = {
  prepare: (sql: string) => Stmt;
};

type RunsDeps = {
  db: DbLike;
  parseJson: <T>(raw: unknown, fallback: T) => T;
  stringifyJson: (value: unknown) => string;
  rebuildTouches: (db: DbLike) => unknown;
  applyAccepted: (db: DbLike, input: Record<string, unknown>) => unknown;
  applyFailed: (db: DbLike, input: Record<string, unknown>) => unknown;
};

function parseRun(row: Record<string, unknown>, parseJson: RunsDeps['parseJson']): Record<string, unknown> {
  return {
    ...row,
    steps: parseJson(row.steps, []),
    logs: parseJson(row.logs, []),
    dispatch_payload: parseJson(row.dispatch_payload, {}),
  };
}

function requireCallbackAuth(req: Request, res: Response): boolean {
  const token = process.env.BATON_CALLBACK_TOKEN;
  if (!token) return true;
  const auth = req.get('authorization') || '';
  if (auth === `Bearer ${token}`) return true;
  res.status(403).json({ error: 'Forbidden' });
  return false;
}

function appendLogs(logs: unknown, body: Record<string, unknown>): Array<Record<string, unknown>> {
  const out = Array.isArray(logs) ? logs.slice() as Array<Record<string, unknown>> : [];
  if (body.message) {
    out.push({ at: new Date().toISOString(), message: String(body.message), progress: body.progress ?? null });
  }
  if (Array.isArray(body.logs)) {
    out.push(...body.logs.map((line) => ({ at: new Date().toISOString(), message: String(line) })));
  }
  return out.slice(-100);
}

export function createRunsRouter(deps: RunsDeps): Router {
  const { db, parseJson, stringifyJson, rebuildTouches, applyAccepted, applyFailed } = deps;
  const router = Router();

  router.get('/stream', (req: Request, res: Response) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });

    res.write(`event: snapshot\ndata: ${JSON.stringify({ ok: true })}\n\n`);
    const timer = setInterval(() => {
      res.write(`event: heartbeat\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
    }, 30000);
    req.on('close', () => clearInterval(timer));
  });

  router.get('/', (req: Request, res: Response) => {
    try {
      const limit = Math.min(Number(req.query.limit || 50), 200);
      let sql = 'SELECT * FROM runs WHERE 1=1';
      const params: unknown[] = [];

      if (typeof req.query.worker_type === 'string') { sql += ' AND worker_type = ?'; params.push(req.query.worker_type); }
      if (typeof req.query.status === 'string') { sql += ' AND status = ?'; params.push(req.query.status); }
      if (typeof req.query.agent_id === 'string') { sql += ' AND agent_id = ?'; params.push(req.query.agent_id); }

      const total = Number(db.prepare(`SELECT COUNT(*) AS n FROM (${sql})`).get(...params)?.n ?? 0);
      sql += ' ORDER BY created_at DESC LIMIT ?';
      params.push(limit);
      const runs = db.prepare(sql).all(...params).map((row) => parseRun(row as Record<string, unknown>, parseJson));
      res.json({ runs, total });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'runs list failed' });
    }
  });

  router.get('/:id', (req: Request, res: Response) => {
    try {
      const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(req.params.id);
      if (!run) return res.status(404).json({ error: 'Not found' });
      res.json(parseRun(run, parseJson));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'run lookup failed' });
    }
  });

  router.post('/:id/ack', (req: Request, res: Response) => {
    if (!requireCallbackAuth(req, res)) return;
    try {
      const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(req.params.id);
      if (!run) return res.status(404).json({ error: 'Not found' });
      const body = (req.body || {}) as Record<string, unknown>;
      const ok = body.ok !== false && ['accepted', 'running', undefined, null].includes(body.status as never);
      if (ok) {
        applyAccepted(db, {
          runId: run.id,
          taskId: run.task_id,
          touchId: run.touch_id,
          agentId: run.agent_id,
          externalRunId: body.external_run_id || null,
        });
      } else {
        applyFailed(db, {
          runId: run.id,
          taskId: run.task_id,
          touchId: run.touch_id,
          agentId: run.agent_id,
          dispatchStatus: 'rejected',
          error: body.message || 'Dispatch rejected.',
        });
      }
      rebuildTouches(db);
      res.json(parseRun(db.prepare('SELECT * FROM runs WHERE id = ?').get(run.id as string) as Record<string, unknown>, parseJson));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'ack failed' });
    }
  });

  router.post('/:id/status', (req: Request, res: Response) => {
    if (!requireCallbackAuth(req, res)) return;
    try {
      const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(req.params.id);
      if (!run) return res.status(404).json({ error: 'Not found' });
      const body = (req.body || {}) as Record<string, unknown>;
      const status = String(body.status || 'running');
      const logs = appendLogs(parseJson(run.logs, []), body);

      if (status === 'failed') {
        applyFailed(db, {
          runId: run.id,
          taskId: run.task_id,
          touchId: run.touch_id,
          agentId: run.agent_id,
          dispatchStatus: 'failed',
          error: body.message || 'Agent reported failure.',
        });
        db.prepare('UPDATE runs SET logs = ? WHERE id = ?').run(stringifyJson(logs), run.id);
      } else if (status === 'cancelled') {
        db.prepare(`UPDATE runs SET status = 'cancelled', logs = ?, last_status_at = datetime('now') WHERE id = ?`)
          .run(stringifyJson(logs), run.id);
        if (run.agent_id) {
          db.prepare(`UPDATE agents SET status = 'idle', current_task_id = NULL, current_run_id = NULL, updated_at = datetime('now') WHERE id = ?`)
            .run(run.agent_id);
        }
      } else {
        db.prepare(`UPDATE runs SET status = 'running', logs = ?, last_status_at = datetime('now'), error = NULL WHERE id = ?`)
          .run(stringifyJson(logs), run.id);
      }
      rebuildTouches(db);
      res.json(parseRun(db.prepare('SELECT * FROM runs WHERE id = ?').get(run.id as string) as Record<string, unknown>, parseJson));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'status update failed' });
    }
  });

  router.post('/', (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const agent_name = typeof body.agent_name === 'string' ? body.agent_name : 'agent';
    const worker_type = body.worker_type ?? null;
    const status = typeof body.status === 'string' ? body.status : 'pending';
    const cost = body.cost ?? 0;
    const tokens = body.tokens ?? 0;
    const started_at = body.started_at ?? null;
    const steps = body.steps ?? [];
    const logs = body.logs ?? [];
    const id = randomUUID();

    try {
      db.prepare(`
      INSERT INTO runs (id, agent_name, worker_type, status, cost, tokens, started_at, steps, logs)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, agent_name, worker_type, status, cost, tokens, started_at, stringifyJson(steps), stringifyJson(logs));
      res.status(201).json(parseRun(db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as Record<string, unknown>, parseJson));
    } catch (error) {
      res.status(500).json({ error: `Insertion failed: ${error instanceof Error ? error.message : 'unknown'}` });
    }
  });

  router.patch('/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const body = (req.body || {}) as Record<string, unknown>;
    const {
      status, ended_at, cost, tokens, logs, steps, output_path, output_preview, fix_attempts,
    } = body;

    const fields: string[] = [];
    const values: unknown[] = [];

    if (status !== undefined) { fields.push('status = ?'); values.push(status); }
    if (ended_at !== undefined) { fields.push('ended_at = ?'); values.push(ended_at); }
    if (cost !== undefined) { fields.push('cost = ?'); values.push(cost); }
    if (tokens !== undefined) { fields.push('tokens = ?'); values.push(tokens); }
    if (logs !== undefined) { fields.push('logs = ?'); values.push(typeof logs === 'string' ? logs : stringifyJson(logs)); }
    if (steps !== undefined) { fields.push('steps = ?'); values.push(typeof steps === 'string' ? steps : stringifyJson(steps)); }
    if (output_path !== undefined) { fields.push('output_path = ?'); values.push(output_path); }
    if (output_preview !== undefined) { fields.push('output_preview = ?'); values.push(output_preview); }
    if (fix_attempts !== undefined) { fields.push('fix_attempts = ?'); values.push(fix_attempts); }

    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

    values.push(id);
    const result = db.prepare(`UPDATE runs SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    if (!result.changes) return res.status(404).json({ error: 'Not found' });
    res.status(200).json(parseRun(db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as Record<string, unknown>, parseJson));
  });

  return router;
}
