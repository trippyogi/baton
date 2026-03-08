'use strict';
const express = require('express');
const Redis   = require('ioredis');
const db      = require('../db');

const router = express.Router();
const redis  = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');

// ── Helpers ────────────────────────────────────────────────────────────────────

async function streamInfo(key) {
  try {
    const raw = await redis.xinfo('STREAM', key);
    // ioredis returns flat array: [field, value, field, value, ...]
    const obj = {};
    for (let i = 0; i < raw.length; i += 2) obj[raw[i]] = raw[i + 1];
    return { length: obj['length'] || 0, firstId: obj['first-entry']?.[0] || null };
  } catch (_) {
    return { length: 0, firstId: null };
  }
}

async function groupInfo(stream) {
  try {
    const rows = await redis.xinfo('GROUPS', stream);
    return rows.map(row => {
      const g = {};
      for (let i = 0; i < row.length; i += 2) g[row[i]] = row[i + 1];
      return { name: g['name'], consumers: g['consumers'], pending: g['pending'], lag: g['lag'] };
    });
  } catch (_) {
    return [];
  }
}

async function pendingJobs(stream, count = 20) {
  try {
    // Use last-delivered-id from consumer group to find only undelivered entries
    const rows = await redis.xinfo('GROUPS', stream);
    let maxId = null;
    for (const row of rows) {
      const g = {};
      for (let i = 0; i < row.length; i += 2) g[row[i]] = row[i + 1];
      const lid = g['last-delivered-id'];
      if (lid && (!maxId || lid > maxId)) maxId = lid;
    }
    // '(' prefix = exclusive start (Redis 6.2+); falls back to full range if no groups
    const start = maxId ? '(' + maxId : '-';
    const entries = await redis.xrange(stream, start, '+', 'COUNT', count);
    return entries.map(([id, fields]) => {
      const f = {};
      for (let i = 0; i < fields.length; i += 2) f[fields[i]] = fields[i + 1];
      let payload = {};
      try { payload = JSON.parse(f.payload || '{}'); } catch (_) {}
      return {
        stream_id: id,
        job_id:    payload.job_id || null,
        type:      payload.type   || payload.worker_type || null,
        repo:      payload.repo   || null,
        created_at: payload.created_at || null,
      };
    });
  } catch (_) {
    return [];
  }
}

async function dlqCount(stream) {
  try { return await redis.xlen(stream); } catch (_) { return 0; }
}

// ── GET /api/queue  — stream overview (queue screen panel A) ──────────────────
router.get('/', async (_req, res) => {
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
        { name: 'jobs:vector',  ...vectorInfo,  groups: vectorGroups  },
      ],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/queue/stream-status  — pending jobs list (webhook + queue screen) ─
router.get('/stream-status', async (_req, res) => {
  try {
    const [pending, dlq, vectorPending, vectorDlq] = await Promise.all([
      pendingJobs('jobs:circuit'),
      dlqCount('jobs:circuit:dlq'),
      pendingJobs('jobs:vector'),
      dlqCount('jobs:vector:dlq'),
    ]);

    res.json({
      circuit: { jobs_pending: pending.length, dlq_count: dlq, pending_jobs: pending },
      vector:  { jobs_pending: vectorPending.length, dlq_count: vectorDlq, pending_jobs: vectorPending },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/queue/stats  — KPI aggregates (queue screen KPI strip) ────────────
router.get('/stats', (_req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);

    const jobsToday    = db.prepare(`SELECT COUNT(*) AS n FROM runs WHERE DATE(started_at) = ?`).get(today).n;
    const successRate  = db.prepare(`
      SELECT ROUND(100.0 * SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) / MAX(COUNT(*),1), 1) AS rate
      FROM runs WHERE started_at IS NOT NULL
    `).get().rate || 0;
    const avgDuration  = db.prepare(`
      SELECT ROUND(AVG((julianday(ended_at) - julianday(started_at)) * 86400), 1) AS avg_sec
      FROM runs WHERE ended_at IS NOT NULL AND started_at IS NOT NULL
    `).get().avg_sec || 0;
    const avgCost      = db.prepare(`SELECT ROUND(AVG(cost),4) AS avg FROM runs WHERE cost > 0`).get().avg || 0;
    const fixUsage     = db.prepare(`SELECT ROUND(AVG(fix_attempts),2) AS avg FROM runs WHERE fix_attempts > 0`).get()?.avg || 0;
    const fixSuccess   = db.prepare(`
      SELECT ROUND(100.0 * SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) / MAX(COUNT(*),1), 1) AS rate
      FROM runs WHERE fix_attempts > 0
    `).get()?.rate || 0;

    res.json({
      jobs_today:       jobsToday,
      success_rate_pct: successRate,
      avg_duration_sec: avgDuration,
      avg_cost_usd:     avgCost,
      fix_loop_avg:     fixUsage,
      fix_success_pct:  fixSuccess,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
