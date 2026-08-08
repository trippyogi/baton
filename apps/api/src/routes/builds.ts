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

function parse(b: Record<string, unknown>): Record<string, unknown> {
  let tags: unknown[] = [];
  try {
    const parsed = JSON.parse(String(b.tags || '[]'));
    tags = Array.isArray(parsed) ? parsed : [];
  } catch {
    tags = [];
  }
  return { ...b, tags };
}

export function createBuildsRouter(db: DbLike): Router {
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    try {
      const builds = db.prepare('SELECT * FROM builds ORDER BY created_at DESC').all();
      res.json(builds.map((row) => parse(row as Record<string, unknown>)));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'builds list failed' });
    }
  });

  router.get('/:id', (req: Request, res: Response) => {
    try {
      const b = db.prepare('SELECT * FROM builds WHERE id = ?').get(req.params.id);
      if (!b) return res.status(404).json({ error: 'Not found' });
      res.json(parse(b));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'build lookup failed' });
    }
  });

  router.post('/', (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      const name = body.name;
      if (!name) return res.status(400).json({ error: 'name required' });
      const description = body.description ?? '';
      const type = body.type ?? 'tool';
      const status = body.status ?? 'shipped';
      const path = body.path ?? '';
      const tags = body.tags ?? [];
      const built_by = body.built_by ?? 'vector+circuit';
      const nightly_date = body.nightly_date ?? null;
      const notes = body.notes ?? '';
      const id = randomUUID();
      db.prepare(`
      INSERT INTO builds (id,name,description,type,status,path,tags,built_by,nightly_date,notes)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(id, name, description, type, status, path, JSON.stringify(tags), built_by, nightly_date, notes);
      res.status(201).json(parse(db.prepare('SELECT * FROM builds WHERE id = ?').get(id) as Record<string, unknown>));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'build create failed' });
    }
  });

  router.patch('/:id', (req: Request, res: Response) => {
    try {
      const b = db.prepare('SELECT * FROM builds WHERE id = ?').get(req.params.id);
      if (!b) return res.status(404).json({ error: 'Not found' });
      const body = (req.body || {}) as Record<string, unknown>;
      const allowed = ['name', 'description', 'type', 'status', 'path', 'tags', 'notes'] as const;
      const updates: string[] = [];
      const vals: unknown[] = [];
      for (const key of allowed) {
        if (key in body) {
          updates.push(`${key} = ?`);
          vals.push(key === 'tags' ? JSON.stringify(body[key]) : body[key]);
        }
      }
      if (!updates.length) return res.status(400).json({ error: 'nothing to update' });
      vals.push(req.params.id);
      db.prepare(`UPDATE builds SET ${updates.join(', ')} WHERE id = ?`).run(...vals);
      res.json(parse(db.prepare('SELECT * FROM builds WHERE id = ?').get(req.params.id) as Record<string, unknown>));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'build update failed' });
    }
  });

  return router;
}
