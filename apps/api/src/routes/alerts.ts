import { randomUUID } from 'node:crypto';
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

export function createAlertsRouter(db: DbLike): Router {
  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    try {
      const includeResolved = req.query.resolved === 'true';
      const sql = includeResolved
        ? 'SELECT * FROM alerts ORDER BY CASE severity WHEN \'critical\' THEN 0 WHEN \'warning\' THEN 1 ELSE 2 END, created_at DESC'
        : 'SELECT * FROM alerts WHERE resolved_at IS NULL ORDER BY CASE severity WHEN \'critical\' THEN 0 WHEN \'warning\' THEN 1 ELSE 2 END, created_at DESC';
      res.json(db.prepare(sql).all());
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'alerts list failed' });
    }
  });

  router.post('/', (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      const type = typeof body.type === 'string' ? body.type : 'info';
      const severity = typeof body.severity === 'string' ? body.severity : 'info';
      const message = body.message;
      if (!message) return res.status(400).json({ error: 'message required' });
      const id = randomUUID();
      db.prepare('INSERT INTO alerts (id,type,severity,message) VALUES (?,?,?,?)').run(id, type, severity, message);
      res.status(201).json(db.prepare('SELECT * FROM alerts WHERE id = ?').get(id));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'alert create failed' });
    }
  });

  router.patch('/:id/resolve', (req: Request, res: Response) => {
    try {
      const alert = db.prepare('SELECT * FROM alerts WHERE id = ?').get(req.params.id);
      if (!alert) return res.status(404).json({ error: 'Not found' });
      db.prepare('UPDATE alerts SET resolved_at = datetime(\'now\') WHERE id = ?').run(req.params.id);
      res.json(db.prepare('SELECT * FROM alerts WHERE id = ?').get(req.params.id));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'alert resolve failed' });
    }
  });

  return router;
}
