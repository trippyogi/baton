'use strict';
const express = require('express');
const db = require('../db');
const router = express.Router();
const { randomUUID } = require('crypto');
const { rebuildTouches, loadSettings, parseTouch } = require('../lib/flow/rebuild');
const { stringifyJson, parseJson } = require('../lib/flow/utils');
const { buildDispatchEnvelope } = require('../lib/dispatch/envelope');
const { publicBaseUrl } = require('../lib/dispatch');

const VALID_STATUSES  = ['inbox','ready','in_progress','waiting','review','done','backlog','archived'];
const VALID_PRIORITIES = ['low','medium','high','critical'];
const VALID_RISK_LEVELS = ['low','medium','high','critical'];
const JSON_FIELDS = ['tags', 'linked_run_ids'];
const ALLOWED_FIELDS = [
  'title', 'description', 'status', 'priority', 'owner', 'tags', 'due_at', 'linked_run_ids',
  'impact_score', 'effort_score', 'domain', 'project_key', 'context_key',
  'autonomy_level', 'risk_level', 'quality_gate', 'spec_quality',
  'human_touch_minutes', 'agent_hours_unlocked', 'confidence_score',
  'quality_score', 'fun_score', 'strategic_optionality',
];
const DEFAULT_TASK = {
  description: '', status: 'inbox', priority: 'medium', owner: 'vector', tags: [], due_at: null,
  linked_run_ids: [], impact_score: 0, effort_score: 0, domain: 'product', project_key: null,
  context_key: null, autonomy_level: 1, risk_level: 'low', quality_gate: 'general',
  spec_quality: 'unknown', human_touch_minutes: 5, agent_hours_unlocked: 0.5,
  confidence_score: 0.7, quality_score: 0.7, fun_score: 0, strategic_optionality: 0,
};

router.get('/', (req, res) => {
  try {
    const includeArchived = req.query.include_archived === 'true';
    let sql = includeArchived
      ? 'SELECT * FROM tasks WHERE 1=1'
      : "SELECT * FROM tasks WHERE status != 'archived'";
    const params = [];
    if (req.query.status)   { sql += ' AND status = ?';   params.push(req.query.status); }
    if (req.query.priority) { sql += ' AND priority = ?'; params.push(req.query.priority); }
    if (req.query.owner)    { sql += ' AND owner = ?';    params.push(req.query.owner); }
    sql += " ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, created_at ASC";
    const tasks = db.prepare(sql).all(...params);
    res.json(tasks.map(parse));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', (req, res) => {
  try {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    if (!task) return res.status(404).json({ error: 'Not found' });
    res.json(parse(task));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/dispatch/prepare', (req, res) => {
  try {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    if (!task) return res.status(404).json({ error: 'Not found' });
    const result = prepareDispatch(task, req.body || {});
    res.status(201).json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', (req, res) => {
  try {
    if (!req.body.title) return res.status(400).json({ error: 'title is required' });
    const body = normalizeTaskBody({ ...DEFAULT_TASK, ...pick(req.body, ALLOWED_FIELDS) }, { partial: false });
    if (body.error) return res.status(400).json({ error: body.error });

    const id = randomUUID();
    const fields = ['id', ...Object.keys(body.values)];
    const placeholders = fields.map(() => '?').join(',');
    const values = [id, ...Object.values(body.values).map(sqlValue)];
    db.prepare(`INSERT INTO tasks (${fields.join(',')}) VALUES (${placeholders})`).run(...values);
    rebuildTouches(db);
    res.status(201).json(parse(db.prepare('SELECT * FROM tasks WHERE id = ?').get(id)));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id', (req, res) => {
  try {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    if (!task) return res.status(404).json({ error: 'Not found' });

    const body = normalizeTaskBody(pick(req.body, ALLOWED_FIELDS), { partial: true });
    if (body.error) return res.status(400).json({ error: body.error });
    const entries = Object.entries(body.values);
    if (!entries.length) return res.status(400).json({ error: 'No valid fields to update' });

    const updates = entries.map(([key]) => `${key} = ?`);
    const vals = entries.map(([, value]) => sqlValue(value));
    updates.push('updated_at = datetime(\'now\')');
    vals.push(req.params.id);
    db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).run(...vals);
    rebuildTouches(db);
    res.json(parse(db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id)));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', (req, res) => {
  try {
    const result = db.prepare(`
      UPDATE tasks
      SET status = 'archived', updated_at = datetime('now')
      WHERE id = ?
    `).run(req.params.id);
    if (!result.changes) return res.status(404).json({ error: 'Not found' });
    db.prepare(`
      UPDATE baton_touches
      SET status = 'archived', updated_at = datetime('now')
      WHERE task_id = ? AND status NOT IN ('resolved', 'archived')
    `).run(req.params.id);
    rebuildTouches(db);
    res.json({ archived: req.params.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

function pick(obj, allowed) {
  const out = {};
  for (const key of allowed) if (key in obj) out[key] = obj[key];
  return out;
}

function normalizeTaskBody(values, { partial }) {
  const out = { ...values };
  if ('status' in out && !VALID_STATUSES.includes(out.status)) return { error: `invalid status: ${out.status}` };
  if ('priority' in out && !VALID_PRIORITIES.includes(out.priority)) return { error: `invalid priority: ${out.priority}` };
  if ('risk_level' in out && !VALID_RISK_LEVELS.includes(out.risk_level)) return { error: `invalid risk_level: ${out.risk_level}` };
  if ('domain' in out && !validDomains().includes(out.domain)) return { error: `invalid domain: ${out.domain}` };
  for (const field of JSON_FIELDS) {
    if (field in out) {
      const normalized = normalizeStringArray(out[field]);
      if (!normalized.ok) return { error: `${field} must be an array of strings` };
      out[field] = normalized.value;
    }
  }
  for (const key of ['impact_score', 'effort_score']) if (key in out) out[key] = clampNumber(out[key], 0, 10, key);
  if ('autonomy_level' in out) out.autonomy_level = clampNumber(out.autonomy_level, 0, 7, 'autonomy_level');
  for (const key of ['confidence_score', 'quality_score', 'fun_score', 'strategic_optionality']) if (key in out) out[key] = clampNumber(out[key], 0, 1, key);
  for (const key of ['human_touch_minutes', 'agent_hours_unlocked']) if (key in out) out[key] = clampNumber(out[key], 0, Number.MAX_SAFE_INTEGER, key);
  for (const [key, value] of Object.entries(out)) if (Number.isNaN(value)) return { error: `invalid numeric value for ${key}` };
  if (!partial && !out.title) return { error: 'title is required' };
  return { values: out };
}

function normalizeStringArray(value) {
  let arr = value;
  if (typeof value === 'string') {
    try { arr = JSON.parse(value); }
    catch (_) { return { ok: false }; }
  }
  if (!Array.isArray(arr)) return { ok: false };
  if (!arr.every(item => typeof item === 'string')) return { ok: false };
  return { ok: true, value: arr };
}

function clampNumber(value, min, max, key) {
  const n = Number(value);
  if (Number.isNaN(n)) return NaN;
  return Math.max(min, Math.min(max, n));
}

function validDomains() {
  return db.prepare('SELECT id FROM portfolio_domains').all().map(r => r.id);
}

function sqlValue(value) {
  return Array.isArray(value) || (value && typeof value === 'object') ? JSON.stringify(value) : value;
}

function parse(t) {
  return { ...t, tags: safeJsonArray(t.tags), linked_run_ids: safeJsonArray(t.linked_run_ids) };
}

function prepareDispatch(task, body) {
  const agent = resolveAgent(task, body);
  const touch = latestTouchForTask(task.id);
  const runId = `run_${randomUUID()}`;
  const parsedTask = parse(task);
  const instructions = normalizeInstructions(body.instructions);
  const run = {
    id: runId,
    task_id: task.id,
    touch_id: touch?.id || null,
    agent_id: agent?.id || null,
  };
  const envelope = buildDispatchEnvelope({
    run,
    task: parsedTask,
    touch,
    agent,
    settings: loadSettings(db),
    baseUrl: publicBaseUrl(),
    instructions,
    intent: body.intent || 'orchestrate',
  });

  db.prepare(`
    INSERT INTO runs (
      id, agent_name, worker_type, status, task_id, touch_id, agent_id,
      dispatch_status, dispatch_transport, dispatch_target, dispatch_payload, steps, logs, created_at
    ) VALUES (?, ?, ?, 'pending_dispatch', ?, ?, ?, 'prepared', ?, ?, ?, '[]', '[]', datetime('now'))
  `).run(
    runId,
    agent?.name || body.agent_name || parsedTask.owner || 'manual',
    agent?.type || null,
    task.id,
    touch?.id || null,
    agent?.id || null,
    agent?.dispatch_transport || 'manual',
    agent?.dispatch_target || null,
    stringifyJson(envelope)
  );

  if (touch?.id) {
    db.prepare(`
      UPDATE baton_touches
      SET status = 'prepared', run_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(runId, touch.id);
  }

  const linked = safeJsonArray(task.linked_run_ids);
  if (!linked.includes(runId)) {
    linked.push(runId);
    db.prepare(`UPDATE tasks SET linked_run_ids = ?, updated_at = datetime('now') WHERE id = ?`).run(stringifyJson(linked), task.id);
  }

  const savedRun = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId);
  rebuildTouches(db);
  return {
    task: parse(db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id)),
    touch: touch?.id ? latestTouchForTask(task.id) : null,
    run: parseRun(savedRun),
    envelope,
    message: 'Dispatch prepared. No agent was launched.',
  };
}

function latestTouchForTask(taskId) {
  const row = db.prepare(`
    SELECT * FROM baton_touches
    WHERE task_id = ? AND status NOT IN ('archived', 'resolved')
    ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'pending' THEN 1 WHEN 'prepared' THEN 2 ELSE 3 END, created_at DESC
    LIMIT 1
  `).get(taskId);
  return row ? parseTouch(row) : null;
}

function resolveAgent(task, body) {
  const ids = [body.agent_id, task.owner, 'strategy-agent', 'ops-agent'].filter(Boolean);
  for (const agentId of ids) {
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
    if (agent) return parseAgent(agent);
  }
  const idle = db.prepare(`SELECT * FROM agents WHERE status = 'idle' ORDER BY name LIMIT 1`).get();
  return idle ? parseAgent(idle) : null;
}

function parseAgent(agent) {
  return {
    ...agent,
    skills: parseJson(agent.skills, []),
    permissions: parseJson(agent.permissions, {}),
    dispatch_config: parseJson(agent.dispatch_config, {}),
  };
}

function normalizeInstructions(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

function parseRun(row) {
  return row ? { ...row, steps: parseJson(row.steps, []), logs: parseJson(row.logs, []), dispatch_payload: parseJson(row.dispatch_payload, {}) } : null;
}

function safeJsonArray(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

module.exports = router;
