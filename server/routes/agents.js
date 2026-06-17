'use strict';
const express = require('express');
const db = require('../db');
const { parseJson, stringifyJson } = require('../lib/flow/utils');
const { rebuildTouches } = require('../lib/flow/rebuild');

const router = express.Router();
const VALID_STATUSES = ['idle', 'running', 'blocked', 'failed', 'reviewing', 'paused', 'offline'];
const VALID_TRANSPORTS = ['manual', 'webhook'];
const JSON_FIELDS = ['skills', 'permissions', 'cost_profile', 'dispatch_config'];
const ALLOWED = ['name', 'type', 'status', 'skills', 'permissions', 'current_task_id', 'current_run_id', 'cost_profile', 'dispatch_enabled', 'dispatch_transport', 'dispatch_target', 'dispatch_config', 'quality_score', 'reliability_score', 'last_activity_at'];
const DEFAULT_AGENT = {
  type: 'general',
  status: 'idle',
  skills: [],
  permissions: {},
  current_task_id: null,
  current_run_id: null,
  cost_profile: {},
  dispatch_enabled: false,
  dispatch_transport: 'manual',
  dispatch_target: null,
  dispatch_config: {},
  quality_score: 0.7,
  reliability_score: 0.7,
  last_activity_at: null,
};

router.get('/', (req, res) => {
  try {
    let sql = 'SELECT * FROM agents WHERE 1=1';
    const params = [];
    if (req.query.status) { sql += ' AND status = ?'; params.push(req.query.status); }
    if (req.query.type) { sql += ' AND type = ?'; params.push(req.query.type); }
    sql += ' ORDER BY CASE status WHEN \'idle\' THEN 0 WHEN \'running\' THEN 1 WHEN \'blocked\' THEN 2 ELSE 3 END, name ASC';
    res.json(db.prepare(sql).all(...params).map(parseAgent));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', (req, res) => {
  try {
    const agent = normalizeAgent(req.body || {}, { partial: false });
    const exists = db.prepare('SELECT id FROM agents WHERE id = ?').get(agent.id);
    if (exists) return res.status(409).json({ error: `agent already exists: ${agent.id}` });

    const fields = ['id', ...ALLOWED];
    db.prepare(`INSERT INTO agents (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`)
      .run(...fields.map(field => sqlValue(agent[field], field)));
    rebuildTouches(db);
    res.status(201).json(parseAgent(db.prepare('SELECT * FROM agents WHERE id = ?').get(agent.id)));
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.get('/:id', (req, res) => {
  try {
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Not found' });
    res.json(parseAgent(agent));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id', (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const body = normalizeAgent(req.body || {}, { partial: true, existing: parseAgent(existing) });
    const updates = [];
    const vals = [];
    for (const key of ALLOWED) {
      if (!(key in body)) continue;
      updates.push(`${key} = ?`);
      vals.push(sqlValue(body[key], key));
    }
    if (!updates.length) return res.status(400).json({ error: 'No valid fields to update' });
    updates.push('updated_at = datetime(\'now\')');
    vals.push(req.params.id);
    db.prepare(`UPDATE agents SET ${updates.join(', ')} WHERE id = ?`).run(...vals);
    rebuildTouches(db);
    res.json(parseAgent(db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id)));
  } catch (err) { res.status(400).json({ error: err.message }); }
});

function normalizeAgent(raw, { partial, existing = {} }) {
  if (!isPlainObject(raw)) throw new Error('agent body must be an object');
  const allowed = new Set(partial ? ALLOWED : ['id', ...ALLOWED]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) throw new Error(`${key} is not an allowed field`);
  }

  const out = partial ? { ...raw } : { ...DEFAULT_AGENT, ...raw };
  if (!partial) {
    if (typeof out.id !== 'string' || !/^[a-z0-9_-]+$/.test(out.id)) throw new Error('id must be lowercase slug text');
    if (typeof out.name !== 'string' || !out.name.trim()) throw new Error('name is required');
    out.name = out.name.trim();
  } else if ('id' in out) {
    throw new Error('id cannot be changed');
  }

  if ('name' in out) {
    if (typeof out.name !== 'string' || !out.name.trim()) throw new Error('name is required');
    out.name = out.name.trim();
  }
  if ('type' in out && (typeof out.type !== 'string' || !out.type.trim())) throw new Error('type must be non-empty text');
  if ('status' in out && !VALID_STATUSES.includes(out.status)) throw new Error(`invalid status: ${out.status}`);
  if ('skills' in out) validateStringArray(out.skills, 'skills');
  for (const key of ['permissions', 'cost_profile', 'dispatch_config']) {
    if (key in out && !isPlainObject(out[key])) throw new Error(`${key} must be an object`);
  }
  if ('dispatch_enabled' in out) out.dispatch_enabled = Boolean(out.dispatch_enabled);
  if ('dispatch_transport' in out && !VALID_TRANSPORTS.includes(out.dispatch_transport)) throw new Error(`invalid dispatch_transport: ${out.dispatch_transport}`);

  const effective = { ...existing, ...out };
  if (effective.dispatch_enabled && (!effective.dispatch_transport || !effective.dispatch_target)) {
    throw new Error('dispatch_enabled requires dispatch_transport and dispatch_target');
  }
  if (effective.dispatch_enabled && effective.dispatch_transport === 'webhook') {
    const target = String(effective.dispatch_target || '');
    if (!isEnvRef(target) && !isLocalhostUrl(target)) throw new Error('webhook dispatch_target must be an env var name or localhost URL');
  }
  for (const key of ['quality_score', 'reliability_score']) {
    if (key in out) out[key] = finiteNumber(out[key], 0, 1, key);
  }
  rejectSecretLike(out);
  return out;
}

function parseAgent(row) {
  return {
    ...row,
    skills: parseJson(row.skills, []),
    permissions: parseJson(row.permissions, {}),
    cost_profile: parseJson(row.cost_profile, {}),
    dispatch_enabled: Boolean(row.dispatch_enabled),
    dispatch_config: parseJson(row.dispatch_config, {}),
  };
}

function sqlValue(value, label) {
  if (JSON_FIELDS.includes(label)) return stringifyJson(value);
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value === undefined ? null : value;
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function validateStringArray(value, label) {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) throw new Error(`${label} must be an array of strings`);
}

function finiteNumber(value, min, max, label) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${label} must be a finite number`);
  return Math.max(min, Math.min(max, n));
}

function isEnvRef(value) {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]*(?:_ENV|_URL|_TOKEN|_SECRET)?$/.test(value);
}

function isLocalhostUrl(value) {
  try {
    const url = new URL(value);
    return ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  } catch (_) { return false; }
}

function rejectSecretLike(value, loc = 'agent') {
  const suspiciousKey = /(?:api[_-]?key|apikey|token|secret|password|private[_-]?key|webhook[_-]?url|bearer)/i;
  const secretValue = /(sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}|Bearer [A-Za-z0-9._-]{20,}|[A-Za-z0-9+/=_-]{48,})/;
  if (Array.isArray(value)) value.forEach((item, index) => rejectSecretLike(item, `${loc}[${index}]`));
  else if (isPlainObject(value)) {
    for (const [key, nested] of Object.entries(value)) {
      const nestedLoc = `${loc}.${key}`;
      const envKey = /_env$/i.test(key);
      if (suspiciousKey.test(key) && !(envKey && isEnvRef(nested))) throw new Error(`secret-looking key rejected at ${nestedLoc}`);
      rejectSecretLike(nested, nestedLoc);
    }
  } else if (typeof value === 'string' && secretValue.test(value) && !isEnvRef(value)) {
    throw new Error(`secret-looking value rejected at ${loc}`);
  }
}

module.exports = router;
