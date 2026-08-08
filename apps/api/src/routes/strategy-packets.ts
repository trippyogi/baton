import { Router } from 'express';
import type { Request, Response } from 'express';

type DbLike = {
  prepare: (sql: string) => {
    all: (...params: unknown[]) => unknown[];
    get: (...params: unknown[]) => unknown;
  };
};

type StrategyPacketsDeps = {
  db: DbLike;
  listStrategyPackets: (db: DbLike, limit?: unknown) => unknown;
  getStrategyPacket: (db: DbLike, id: string) => unknown | null;
  createStrategyPacket: (db: DbLike, input: Record<string, unknown>) => unknown;
};

export function createStrategyPacketsRouter(deps: StrategyPacketsDeps): Router {
  const { db, listStrategyPackets, getStrategyPacket, createStrategyPacket } = deps;
  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    try {
      res.json(listStrategyPackets(db, req.query.limit || 25));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'strategy packets list failed' });
    }
  });

  router.get('/:id', (req: Request, res: Response) => {
    try {
      const packet = getStrategyPacket(db, String(req.params.id));
      if (!packet) return res.status(404).json({ error: 'Not found' });
      res.json(packet);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'strategy packet lookup failed' });
    }
  });

  router.post('/', (req: Request, res: Response) => {
    try {
      const result = createStrategyPacket(db, (req.body || {}) as Record<string, unknown>);
      res.status(201).json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'strategy packet create failed';
      const status = /goal is required/i.test(message) ? 400 : 500;
      res.status(status).json({ error: message });
    }
  });

  return router;
}
