'use strict';
const express = require('express');
const db      = require('../db');
const router  = express.Router();

router.get('/', (_req, res) => {
  try {
    const activeRuns = db.prepare(`
      SELECT id, agent_name, status, cost, tokens, started_at
      FROM runs WHERE status = 'running' ORDER BY started_at DESC
    `).all();

    const priorityQueue = db.prepare(`
      SELECT id, title, status, priority, owner, due_at
      FROM tasks
      WHERE status NOT IN ('done','backlog','archived')
      ORDER BY
        CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
        created_at ASC
      LIMIT 5
    `).all();

    const today = new Date().toISOString().slice(0, 10);
    const costToday = db.prepare(`
      SELECT COALESCE(SUM(cost), 0) as total FROM provider_usage WHERE day = ?
    `).get(today).total;

    const alerts = db.prepare(`
      SELECT id, type, severity, message, created_at
      FROM alerts WHERE resolved_at IS NULL
      ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END
    `).all();

    const taskStats = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done,
        SUM(CASE WHEN status = 'waiting' THEN 1 ELSE 0 END) as waiting,
        SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) as ready,
        SUM(CASE WHEN priority = 'critical' AND status NOT IN ('done','archived') THEN 1 ELSE 0 END) as critical_open,
        SUM(CASE WHEN due_at IS NOT NULL AND due_at < datetime('now') AND status NOT IN ('done','backlog','archived') THEN 1 ELSE 0 END) as overdue
      FROM tasks WHERE status != 'archived'
    `).get();

    const pendingRuns = db.prepare(`SELECT COUNT(*) as n FROM runs WHERE status = 'pending'`).get().n;

    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const costYesterday = db.prepare(
      `SELECT COALESCE(SUM(cost), 0) as total FROM provider_usage WHERE day = ?`
    ).get(yesterday).total;

    const recentRuns = db.prepare(`
      SELECT id, agent_name, status, cost, tokens, started_at, ended_at
      FROM runs ORDER BY created_at DESC LIMIT 10
    `).all();

    res.json({
      activeRuns,
      priorityQueue,
      costToday:     Math.round(costToday * 100) / 100,
      costYesterday: Math.round(costYesterday * 100) / 100,
      pendingRuns,
      alerts,
      taskStats,
      recentRuns,
      health: {
        status:       alerts.some(a => a.severity === 'critical') ? 'critical'
                    : alerts.some(a => a.severity === 'warning')  ? 'degraded'
                    : 'healthy',
        agentsOnline: 2,
        gatewayUp:    true
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
