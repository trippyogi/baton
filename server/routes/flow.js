'use strict';
const express = require('express');
const db = require('../db');
const { VALID_MODES, normalizeMode } = require('../lib/flow/modes');
const { loadSettings, rebuildTouches, listOpenTouches } = require('../lib/flow/rebuild');
const { executeCommand } = require('../lib/flow/commands');

const router = express.Router();

router.get('/', (req, res) => {
  try {
    rebuildTouches(db);
    const settings = loadSettings(db);
    const limit = Number(req.query.limit || settings.max_visible_touches || 7);
    res.json({
      mode: settings.current_mode,
      settings: {
        max_visible_touches: settings.max_visible_touches,
        review_debt_limit: settings.review_debt_limit,
        agent_wip_limit: settings.agent_wip_limit,
        active_context_key: settings.active_context_key,
        active_project_key: settings.active_project_key,
      },
      airspace: getAirspace(),
      next_touches: listOpenTouches(db, limit),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/mode', (req, res) => {
  try {
    const mode = normalizeMode(req.body.mode);
    if (!VALID_MODES.includes(mode)) return res.status(400).json({ error: `invalid mode: ${req.body.mode}` });
    db.prepare(`
      UPDATE flow_settings
      SET current_mode = ?, active_context_key = COALESCE(?, active_context_key),
          active_project_key = COALESCE(?, active_project_key), updated_at = datetime('now')
      WHERE id = 'default'
    `).run(mode, req.body.active_context_key ?? null, req.body.active_project_key ?? null);
    rebuildTouches(db);
    const settings = loadSettings(db);
    res.json({ mode: settings.current_mode, active_context_key: settings.active_context_key, active_project_key: settings.active_project_key, updated_at: settings.updated_at });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/command', (req, res) => {
  try {
    const result = executeCommand(db, req.body.input || '');
    if (result.error) return res.status(400).json(result);
    res.status(result.created ? 201 : 200).json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

function countTask(status) {
  return db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE status = ?').get(status).n;
}

function getAirspace() {
  const stale = db.prepare(`
    SELECT COUNT(*) AS n FROM tasks
    WHERE status = 'in_progress'
      AND updated_at <= datetime('now', '-30 minutes')
  `).get().n;
  const failed = db.prepare(`SELECT COUNT(*) AS n FROM runs WHERE status IN ('failed', 'error')`).get().n;
  return {
    running: countTask('in_progress'),
    needs_touch: countTask('waiting'),
    review: countTask('review'),
    idle: db.prepare("SELECT COUNT(*) AS n FROM agents WHERE status = 'idle'").get().n,
    stale,
    failed,
    ready_to_pass: countTask('ready'),
    inbox: countTask('inbox'),
  };
}

module.exports = router;
