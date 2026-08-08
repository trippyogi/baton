import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Router } from 'express';
import type { Request, Response } from 'express';

const DEFAULT_CREATIVE_LOG = resolve('/home/ubuntu/clawd/config/creative-log.json');

export function createCreativesRouter(creativeLogPath = DEFAULT_CREATIVE_LOG): Router {
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    try {
      const raw = readFileSync(creativeLogPath, 'utf8');
      const data = JSON.parse(raw);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: true, message: err instanceof Error ? err.message : 'creatives read failed' });
    }
  });

  return router;
}
