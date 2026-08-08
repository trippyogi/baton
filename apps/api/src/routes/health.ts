import { Router } from 'express';
import type { Request, Response } from 'express';

type DbLike = {
  prepare: (sql: string) => { get: () => unknown };
};

export function createHealthRouter(db: DbLike): Router {
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    try {
      db.prepare('SELECT 1 AS ok').get();
      res.json({
        ok: true,
        app: 'baton',
        db: true,
        redis_required: false,
        redis: 'unknown',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'database unavailable';
      res.status(500).json({
        ok: false,
        app: 'baton',
        db: false,
        redis_required: false,
        redis: 'unknown',
        error: message,
      });
    }
  });

  return router;
}
