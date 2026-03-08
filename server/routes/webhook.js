const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const Redis = require('ioredis');
const redisClient = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');
const router = express.Router();

// Function to validate the HMAC — must use raw body bytes (not re-serialized JSON)
const validateHMAC = (req) => {
  const signature = req.headers['x-hub-signature-256'];
  if (!signature) return false;
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    console.warn('[webhook] GITHUB_WEBHOOK_SECRET not set — rejecting');
    return false;
  }
  const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body));
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(rawBody);
  const expectedSignature = `sha256=${hmac.digest('hex')}`;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
};

router.post('/', async (req, res) => {
  if (!validateHMAC(req)) {
    return res.status(403).send('Invalid signature');
  }
  const { action, check_suite } = req.body;
  if (action !== 'completed' || check_suite.conclusion !== 'failure') {
    return res.status(200).send('Ignoring non-failure event');
  }

  const headBranch = check_suite.head_branch;
  if (!headBranch.startsWith('circuit/')) {
    return res.status(200).send('Ignoring non-circuit branch');
  }

  const jobId = headBranch.split('/')[1];
  console.log(`Received job ID: ${jobId}`);

  const run = db.prepare(`SELECT * FROM runs WHERE id = ?`);
  const runDetails = run.get(jobId);

  // If fixes have been attempted too many times, give up
  if (runDetails && runDetails.fix_attempts >= 3) {
    const update = db.prepare(`UPDATE runs SET status = 'failed' WHERE id = ?`);
    update.run(jobId);
    return res.status(200).send('Run marked as failed — max fix attempts reached');
  }

  const fetchLogs = await fetch(`https://api.github.com/repos/${req.body.repository.full_name}/check-suites/${check_suite.id}/check-runs`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${process.env.GITHUB_WORKER_TOKEN}` }
  });
  const ciLogs = await fetchLogs.json();

  // Dispatch fix job to Redis queue
  const fixJob = {
    job_id: require('crypto').randomUUID(),
    schema_version: 1,
    type: 'fix',
    created_at: new Date().toISOString(),
    repo: req.body.repository.full_name,
    base_branch: 'main',
    target_branch: headBranch,
    prompt: `CI failed on branch ${headBranch}. Fix the TypeScript errors so all checks pass.`,
    model_policy: 'mid',
    max_iterations: 3,
    max_spend_usd: 1.00,
    timeout_sec: 300,
    context: {
      original_job_id: jobId,
      fix_attempt: runDetails ? runDetails.fix_attempts + 1 : 1,
      ci_conclusion: check_suite.conclusion,
      ci_logs: ciLogs,
    },
  };
  await redisClient.xadd('jobs:circuit', '*', 'payload', JSON.stringify(fixJob));

  // Increment fix_attempts counter if we have a DB record
  if (runDetails) {
    const incrementFixAttempts = db.prepare(`UPDATE runs SET fix_attempts = fix_attempts + 1 WHERE id = ?`);
    incrementFixAttempts.run(jobId);
  }

  res.status(200).send('Fix job dispatched');
});

module.exports = router;