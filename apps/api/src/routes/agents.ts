import { Router } from 'express';
import type { Request, Response } from 'express';

type Stmt = {
  all: (...params: unknown[]) => unknown[];
  get: (...params: unknown[]) => Record<string, unknown> | undefined;
  run: (...params: unknown[]) => unknown;
};

type DbLike = {
  prepare: (sql: string) => Stmt;
};

const VALID_STATUSES = ['idle', 'running', 'blocked', 'failed', 'reviewing', 'paused', 'offline'] as const;
const ALLOWED = [
  'name', 'type', 'status', 'skills', 'permissions', 'current_task_id', 'current_run_id',
  'cost_profile', 'dispatch_enabled', 'dispatch_transport', 'dispatch_target', 'dispatch_config',
  'quality_score', 'reliability_score', 'last_activity_at',
] as const;

type AgentsDeps = {
  db: DbLike;
  parseJson: <T>(raw: unknown, fallback: T) => T;
  stringifyJson: (value: unknown) => string;
  rebuildTouches: (db: DbLike) => unknown;
};

function parseAgent(
  row: Record<string, unknown>,
  parseJson: AgentsDeps['parseJson'],
): Record<string, unknown> {
  return {
    ...row,
    skills: parseJson(row.skills, []),
    permissions: parseJson(row.permissions, {}),
    cost_profile: parseJson(row.cost_profile, {}),
    dispatch_enabled: Boolean(row.dispatch_enabled),
    dispatch_config: parseJson(row.dispatch_config, {}),
  };
}

export function createAgentsRouter(deps: AgentsDeps): Router {
  const { db, parseJson, stringifyJson, rebuildTouches } = deps;
  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    try {
      let sql = 'SELECT * FROM agents WHERE 1=1';
      const params: unknown[] = [];
      if (typeof req.query.status === 'string') {
        sql += ' AND status = ?';
        params.push(req.query.status);
      }
      if (typeof req.query.type === 'string') {
        sql += ' AND type = ?';
        params.push(req.query.type);
      }
      sql += ' ORDER BY CASE status WHEN \'idle\' THEN 0 WHEN \'running\' THEN 1 WHEN \'blocked\' THEN 2 ELSE 3 END, name ASC';
      res.json(db.prepare(sql).all(...params).map((row) => parseAgent(row as Record<string, unknown>, parseJson)));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'agents list failed' });
    }
  });

  router.get('/:id', (req: Request, res: Response) => {
    try {
      const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
      if (!agent) return res.status(404).json({ error: 'Not found' });
      res.json(parseAgent(agent, parseJson));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'agent lookup failed' });
    }
  });

  router.patch('/:id', (req: Request, res: Response) => {
    try {
      const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
      if (!agent) return res.status(404).json({ error: 'Not found' });
      const body = (req.body || {}) as Record<string, unknown>;
      if (body.status && !VALID_STATUSES.includes(body.status as typeof VALID_STATUSES[number])) {
        return res.status(400).json({ error: `invalid status: ${String(body.status)}` });
      }

      const updates: string[] = [];
      const vals: unknown[] = [];
      for (const key of ALLOWED) {
        if (!(key in body)) continue;
        updates.push(`${key} = ?`);
        vals.push(['skills', 'permissions', 'cost_profile', 'dispatch_config'].includes(key)
          ? stringifyJson(body[key])
          : body[key]);
      }
      if (!updates.length) return res.status(400).json({ error: 'No valid fields to update' });
      updates.push('updated_at = datetime(\'now\')');
      vals.push(req.params.id);
      db.prepare(`UPDATE agents SET ${updates.join(', ')} WHERE id = ?`).run(...vals);
      rebuildTouches(db);
      const updated = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
      res.json(parseAgent(updated as Record<string, unknown>, parseJson));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'agent update failed' });
    }
  });

  return router;
}
