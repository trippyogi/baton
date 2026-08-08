import { Router } from 'express';
import type { DbLike } from '../../domain/types';
import { createV1TouchesRouter } from './touches';
import { createV1DomainRouter } from './domain';

export function createV1Router(db: DbLike): Router {
  const router = Router();
  router.use('/touches', createV1TouchesRouter(db));
  router.use(createV1DomainRouter(db));
  router.get('/health', (_req, res) => {
    res.json({ ok: true, api: 'v1', phase: 3 });
  });
  return router;
}
