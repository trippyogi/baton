import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';

type Stmt = {
  get: (...params: unknown[]) => Record<string, unknown> | undefined;
  run: (...params: unknown[]) => unknown;
};

type DbLike = {
  prepare: (sql: string) => Stmt;
};

type RedisLike = {
  xadd: (...args: unknown[]) => Promise<unknown>;
  on: (event: string, handler: (...args: unknown[]) => void) => unknown;
};

type RawBodyRequest = Request & { rawBody?: Buffer };

type WebhookDeps = {
  db: DbLike;
  redis: RedisLike;
};

function validateHMAC(req: RawBodyRequest): boolean {
  const signature = req.headers['x-hub-signature-256'];
  if (!signature || typeof signature !== 'string') return false;
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    console.warn('[webhook] GITHUB_WEBHOOK_SECRET not set — rejecting');
    return false;
  }
  const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body));
  const hmac = createHmac('sha256', secret);
  hmac.update(rawBody);
  const expectedSignature = `sha256=${hmac.digest('hex')}`;
  const actual = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function createWebhookRouter(deps: WebhookDeps): Router {
  const { db, redis } = deps;
  const router = Router();

  router.post('/', async (req: Request, res: Response) => {
    if (!validateHMAC(req as RawBodyRequest)) {
      return res.status(403).send('Invalid signature');
    }
    const body = (req.body || {}) as Record<string, unknown>;
    const action = body.action;
    const check_suite = body.check_suite as Record<string, unknown> | undefined;
    if (!check_suite) return res.status(200).send('Ignoring non-check-suite event');
    if (action !== 'completed' || check_suite.conclusion !== 'failure') {
      return res.status(200).send('Ignoring non-failure event');
    }

    const headBranch = String(check_suite.head_branch || '');
    if (!headBranch.startsWith('circuit/')) {
      return res.status(200).send('Ignoring non-circuit branch');
    }

    const jobId = headBranch.split('/')[1];
    console.log(`Received job ID: ${jobId}`);

    const runDetails = db.prepare('SELECT * FROM runs WHERE id = ?').get(jobId);

    if (runDetails && Number(runDetails.fix_attempts) >= 3) {
      db.prepare(`UPDATE runs SET status = 'failed' WHERE id = ?`).run(jobId);
      return res.status(200).send('Run marked as failed — max fix attempts reached');
    }

    const repository = body.repository as Record<string, unknown> | undefined;
    const repoName = repository?.full_name as string | undefined;
    if (!repoName) return res.status(200).send('Ignoring event without repository');

    const fetchLogs = await fetch(`https://api.github.com/repos/${repoName}/check-suites/${check_suite.id}/check-runs`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${process.env.GITHUB_WORKER_TOKEN}` },
    });
    const ciLogs = await fetchLogs.json();

    const fixJob = {
      job_id: randomUUID(),
      schema_version: 1,
      type: 'fix',
      created_at: new Date().toISOString(),
      repo: repoName,
      base_branch: 'main',
      target_branch: headBranch,
      prompt: `CI failed on branch ${headBranch}. Fix the TypeScript errors so all checks pass.`,
      model_policy: 'mid',
      max_iterations: 3,
      max_spend_usd: 1.00,
      timeout_sec: 300,
      context: {
        original_job_id: jobId,
        fix_attempt: runDetails ? Number(runDetails.fix_attempts) + 1 : 1,
        ci_conclusion: check_suite.conclusion,
        ci_logs: ciLogs,
      },
    };
    try {
      await redis.xadd('jobs:circuit', '*', 'payload', JSON.stringify(fixJob));
    } catch (err) {
      console.warn('[webhook] Redis unavailable; fix job was not dispatched:', err instanceof Error ? err.message : err);
      return res.status(503).send('Redis queue unavailable; fix job not dispatched');
    }

    if (runDetails) {
      db.prepare(`UPDATE runs SET fix_attempts = fix_attempts + 1 WHERE id = ?`).run(jobId);
    }

    res.status(200).send('Fix job dispatched');
  });

  return router;
}
