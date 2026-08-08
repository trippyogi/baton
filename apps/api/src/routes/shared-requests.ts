import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

type Stmt = {
  all: (...params: unknown[]) => unknown[];
  get: (...params: unknown[]) => Record<string, unknown> | undefined;
  run: (...params: unknown[]) => unknown;
};

type DbLike = {
  prepare: (sql: string) => Stmt;
};

const VALID_STATUSES = ['pending', 'done', 'dismissed'] as const;
const VALID_USERS = ['operator', 'collaborator'] as const;

export function createSharedRequestsAuth(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = process.env.SHARED_REQUESTS_TOKEN;
    if (!token) {
      return res.status(503).json({ error: 'SHARED_REQUESTS_TOKEN not configured on server' });
    }
    const header = req.headers.authorization || '';
    const provided = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
    if (!provided || provided !== token) {
      return res.status(401).json({ error: 'Unauthorized — invalid or missing bearer token' });
    }
    next();
  };
}

export function createSharedRequestsRouter(
  db: DbLike,
  requireAuth: RequestHandler = createSharedRequestsAuth(),
): Router {
  const router = Router();
  router.use(requireAuth);

  router.post('/', (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      const from = body.from;
      const to = body.to;
      const request = body.request;
      const artifact_url = body.artifact_url ?? null;
      if (!from || !to || !request) {
        return res.status(400).json({ error: 'from, to, and request are required' });
      }
      if (!VALID_USERS.includes(from as typeof VALID_USERS[number])) {
        return res.status(400).json({ error: `invalid from user: ${from}` });
      }
      if (!VALID_USERS.includes(to as typeof VALID_USERS[number])) {
        return res.status(400).json({ error: `invalid to user: ${to}` });
      }
      if (from === to) return res.status(400).json({ error: 'from and to must differ' });

      const id = randomUUID();
      db.prepare(`
      INSERT INTO shared_requests (id, from_user, to_user, request, artifact_url, status)
      VALUES (?, ?, ?, ?, ?, 'pending')
    `).run(id, from, to, request, artifact_url);

      const row = db.prepare('SELECT * FROM shared_requests WHERE id = ?').get(id);
      return res.status(201).json(row);
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'shared request create failed' });
    }
  });

  router.get('/', (req: Request, res: Response) => {
    try {
      let sql = 'SELECT * FROM shared_requests WHERE 1=1';
      const params: unknown[] = [];

      if (typeof req.query.to === 'string') { sql += ' AND to_user = ?'; params.push(req.query.to); }
      if (typeof req.query.from === 'string') { sql += ' AND from_user = ?'; params.push(req.query.from); }
      if (typeof req.query.status === 'string') { sql += ' AND status = ?'; params.push(req.query.status); }

      sql += " ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC";

      const rows = db.prepare(sql).all(...params);
      return res.json(rows);
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'shared requests list failed' });
    }
  });

  router.patch('/:id', (req: Request, res: Response) => {
    try {
      const row = db.prepare('SELECT * FROM shared_requests WHERE id = ?').get(req.params.id);
      if (!row) return res.status(404).json({ error: 'Not found' });

      const body = (req.body || {}) as Record<string, unknown>;
      const status = body.status;
      if (!status) return res.status(400).json({ error: 'status is required' });
      if (!VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) {
        return res.status(400).json({
          error: `invalid status: ${status}. Must be one of: ${VALID_STATUSES.join(', ')}`,
        });
      }

      db.prepare(`
      UPDATE shared_requests SET status = ?, updated_at = datetime('now') WHERE id = ?
    `).run(status, req.params.id);

      const updated = db.prepare('SELECT * FROM shared_requests WHERE id = ?').get(req.params.id);
      return res.json(updated);
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'shared request update failed' });
    }
  });

  router.delete('/:id', (req: Request, res: Response) => {
    try {
      const row = db.prepare('SELECT * FROM shared_requests WHERE id = ?').get(req.params.id);
      if (!row) return res.status(404).json({ error: 'Not found' });

      db.prepare('DELETE FROM shared_requests WHERE id = ?').run(req.params.id);
      return res.status(204).send();
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'shared request delete failed' });
    }
  });

  return router;
}
