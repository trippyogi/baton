import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Router } from 'express';
import type { Request, Response } from 'express';

const CORE_PATH = '/home/ubuntu/clawd/MEMORY.md';
const MEMORY_DIR = '/home/ubuntu/clawd/memory';

export function createMemoryRouter(
  paths: { corePath?: string; memoryDir?: string } = {},
): Router {
  const corePath = paths.corePath || CORE_PATH;
  const memoryDir = paths.memoryDir || MEMORY_DIR;
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    try {
      const core = existsSync(corePath) ? readFileSync(corePath, 'utf8') : null;

      const today = new Date().toISOString().slice(0, 10);
      let dailyDate: string | null = null;
      let daily: string | null = null;

      const todayPath = join(memoryDir, `${today}.md`);
      if (existsSync(todayPath)) {
        daily = readFileSync(todayPath, 'utf8');
        dailyDate = today;
      } else if (existsSync(memoryDir)) {
        const files = readdirSync(memoryDir)
          .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
          .sort()
          .reverse();
        if (files.length) {
          const latest = files[0]!;
          dailyDate = latest.replace('.md', '');
          daily = readFileSync(join(memoryDir, latest), 'utf8');
        }
      }

      res.json({ core, daily, dailyDate });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'memory read failed' });
    }
  });

  return router;
}
