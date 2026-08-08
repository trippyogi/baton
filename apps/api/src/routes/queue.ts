import { Router } from 'express';
import type { Request, Response } from 'express';

type Stmt = {
  get: (...params: unknown[]) => Record<string, unknown> | undefined;
};

type DbLike = {
  prepare: (sql: string) => Stmt;
};

export type RedisLike = {
  xinfo: (...args: unknown[]) => Promise<unknown>;
  xrange: (...args: unknown[]) => Promise<unknown>;
  xlen: (...args: unknown[]) => Promise<number>;
  on: (event: string, handler: (...args: unknown[]) => void) => unknown;
};

type QueueDeps = {
  db: DbLike;
  redis: RedisLike;
};

export function createQueueRouter(deps: QueueDeps): Router {
  const { db, redis } = deps;
  const router = Router();

  async function streamInfo(key: string): Promise<{ length: number; firstId: string | null }> {
    try {
      const raw = await redis.xinfo('STREAM', key) as unknown[];
      const obj: Record<string, unknown> = {};
      for (let i = 0; i < raw.length; i += 2) obj[String(raw[i])] = raw[i + 1];
      const first = obj['first-entry'] as unknown[] | undefined;
      return { length: Number(obj.length || 0), firstId: (first?.[0] as string) || null };
    } catch {
      return { length: 0, firstId: null };
    }
  }

  async function groupInfo(stream: string): Promise<Array<Record<string, unknown>>> {
    try {
      const rows = await redis.xinfo('GROUPS', stream) as unknown[][];
      return rows.map((row) => {
        const g: Record<string, unknown> = {};
        for (let i = 0; i < row.length; i += 2) g[String(row[i])] = row[i + 1];
        return { name: g.name, consumers: g.consumers, pending: g.pending, lag: g.lag };
      });
    } catch {
      return [];
    }
  }

  async function pendingJobs(stream: string, count = 20): Promise<Array<Record<string, unknown>>> {
    try {
      const rows = await redis.xinfo('GROUPS', stream) as unknown[][];
      let maxId: string | null = null;
      for (const row of rows) {
        const g: Record<string, unknown> = {};
        for (let i = 0; i < row.length; i += 2) g[String(row[i])] = row[i + 1];
        const lid = g['last-delivered-id'] as string | undefined;
        if (lid && (!maxId || lid > maxId)) maxId = lid;
      }
      const start = maxId ? `(${maxId}` : '-';
      const entries = await redis.xrange(stream, start, '+', 'COUNT', count) as Array<[string, unknown[]]>;
      return entries.map(([entryId, fields]) => {
        const f: Record<string, unknown> = {};
        for (let i = 0; i < fields.length; i += 2) f[String(fields[i])] = fields[i + 1];
        let payload: Record<string, unknown> = {};
        try { payload = JSON.parse(String(f.payload || '{}')); } catch { /* ignore */ }
        return {
          stream_id: entryId,
          job_id: payload.job_id || null,
          type: payload.type || payload.worker_type || null,
          repo: payload.repo || null,
          created_at: payload.created_at || null,
        };
      });
    } catch {
      return [];
    }
  }

  async function dlqCount(stream: string): Promise<number> {
    try { return await redis.xlen(stream); } catch { return 0; }
  }

  router.get('/', async (_req: Request, res: Response) => {
    try {
      const [circuitInfo, circuitGroups, vectorInfo, vectorGroups] = await Promise.all([
        streamInfo('jobs:circuit'),
        groupInfo('jobs:circuit'),
        streamInfo('jobs:vector'),
        groupInfo('jobs:vector'),
      ]);

      res.json({
        streams: [
          { name: 'jobs:circuit', ...circuitInfo, groups: circuitGroups },
          { name: 'jobs:vector', ...vectorInfo, groups: vectorGroups },
        ],
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'queue overview failed' });
    }
  });

  router.get('/stream-status', async (_req: Request, res: Response) => {
    try {
      const [pending, dlq, vectorPending, vectorDlq] = await Promise.all([
        pendingJobs('jobs:circuit'),
        dlqCount('jobs:circuit:dlq'),
        pendingJobs('jobs:vector'),
        dlqCount('jobs:vector:dlq'),
      ]);

      res.json({
        circuit: { jobs_pending: pending.length, dlq_count: dlq, pending_jobs: pending },
        vector: { jobs_pending: vectorPending.length, dlq_count: vectorDlq, pending_jobs: vectorPending },
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'queue stream-status failed' });
    }
  });

  router.get('/stats', (_req: Request, res: Response) => {
    try {
      const today = new Date().toISOString().slice(0, 10);

      const jobsToday = Number(db.prepare(`SELECT COUNT(*) AS n FROM runs WHERE DATE(started_at) = ?`).get(today)?.n ?? 0);
      const successRate = Number(db.prepare(`
      SELECT ROUND(100.0 * SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) / MAX(COUNT(*),1), 1) AS rate
      FROM runs WHERE started_at IS NOT NULL
    `).get()?.rate ?? 0);
      const avgDuration = Number(db.prepare(`
      SELECT ROUND(AVG((julianday(ended_at) - julianday(started_at)) * 86400), 1) AS avg_sec
      FROM runs WHERE ended_at IS NOT NULL AND started_at IS NOT NULL
    `).get()?.avg_sec ?? 0);
      const avgCost = Number(db.prepare(`SELECT ROUND(AVG(cost),4) AS avg FROM runs WHERE cost > 0`).get()?.avg ?? 0);
      const fixUsage = Number(db.prepare(`SELECT ROUND(AVG(fix_attempts),2) AS avg FROM runs WHERE fix_attempts > 0`).get()?.avg ?? 0);
      const fixSuccess = Number(db.prepare(`
      SELECT ROUND(100.0 * SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) / MAX(COUNT(*),1), 1) AS rate
      FROM runs WHERE fix_attempts > 0
    `).get()?.rate ?? 0);

      res.json({
        jobs_today: jobsToday,
        success_rate_pct: successRate,
        avg_duration_sec: avgDuration,
        avg_cost_usd: avgCost,
        fix_loop_avg: fixUsage,
        fix_success_pct: fixSuccess,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'queue stats failed' });
    }
  });

  return router;
}
