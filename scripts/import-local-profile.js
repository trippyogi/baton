#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_PROFILE = path.join(ROOT, 'local', 'profile.json');
const TASK_STATUSES = ['inbox', 'ready', 'in_progress', 'waiting', 'review', 'done', 'backlog', 'archived'];
const TASK_PRIORITIES = ['low', 'medium', 'high', 'critical'];
const RISK_LEVELS = ['low', 'medium', 'high', 'critical'];
const AGENT_STATUSES = ['idle', 'running', 'blocked', 'failed', 'reviewing', 'paused', 'offline'];
const DEFAULT_DOMAINS = ['revenue', 'product', 'code', 'content', 'personal_brand', 'relationships', 'health_life', 'creative_exploration', 'learning', 'fun', 'maintenance', 'admin'];
const TASK_ARRAY_FIELDS = new Set(['tags', 'linked_run_ids']);
const AGENT_ARRAY_FIELDS = new Set(['skills']);
const TASK_OBJECT_FIELDS = new Set([]);
const AGENT_OBJECT_FIELDS = new Set(['permissions', 'cost_profile', 'dispatch_config']);
const TASK_FIELDS = new Set([
  'id', 'title', 'description', 'status', 'priority', 'owner', 'tags', 'due_at', 'linked_run_ids',
  'impact_score', 'effort_score', 'domain', 'project_key', 'context_key', 'autonomy_level',
  'risk_level', 'quality_gate', 'spec_quality', 'human_touch_minutes', 'agent_hours_unlocked',
  'confidence_score', 'quality_score', 'fun_score', 'strategic_optionality',
]);
const AGENT_FIELDS = new Set([
  'id', 'name', 'type', 'status', 'skills', 'permissions', 'current_task_id', 'current_run_id',
  'cost_profile', 'dispatch_enabled', 'dispatch_transport', 'dispatch_target', 'dispatch_config',
  'quality_score', 'reliability_score', 'last_activity_at',
]);
const DEFAULT_TASK = {
  description: '', status: 'inbox', priority: 'medium', owner: 'operator', tags: [], due_at: null,
  linked_run_ids: [], impact_score: 0, effort_score: 0, domain: 'product', project_key: null,
  context_key: null, autonomy_level: 1, risk_level: 'low', quality_gate: 'general',
  spec_quality: 'unknown', human_touch_minutes: 5, agent_hours_unlocked: 0.5,
  confidence_score: 0.7, quality_score: 0.7, fun_score: 0, strategic_optionality: 0,
};
const DEFAULT_AGENT = {
  type: 'general', status: 'idle', skills: [], permissions: {}, current_task_id: null,
  current_run_id: null, cost_profile: {}, dispatch_enabled: false, dispatch_transport: 'manual',
  dispatch_target: null, dispatch_config: {}, quality_score: 0.7, reliability_score: 0.7,
  last_activity_at: null,
};

function usage() {
  return `Usage: node scripts/import-local-profile.js [profile.json] [options]

Import a public-safe local BATON profile from an ignored private file.

Options:
  --dry-run                         Validate and summarize without writing SQLite
  --json                            Emit machine-readable output
  --mode insert|upsert              Insert new records only, or update by stable ID
  --allow-external-dispatch-targets Allow non-local webhook targets explicitly
  -h, --help                        Show this help
`;
}

function parseArgs(argv) {
  const opts = { profile: null, dryRun: false, json: false, allowExternalDispatchTargets: false, mode: 'insert', help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') opts.help = true;
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--json') opts.json = true;
    else if (arg === '--allow-external-dispatch-targets') opts.allowExternalDispatchTargets = true;
    else if (arg === '--mode') opts.mode = argv[++i] || '';
    else if (arg.startsWith('--mode=')) opts.mode = arg.slice('--mode='.length);
    else if (!arg.startsWith('--') && !opts.profile) opts.profile = arg;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!['insert', 'upsert'].includes(opts.mode)) throw new Error('mode must be insert or upsert');
  opts.profile = path.resolve(ROOT, opts.profile || DEFAULT_PROFILE);
  return opts;
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function isEnvRef(value) {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]*(?:_ENV|_URL|_TOKEN|_SECRET)?$/.test(value);
}

function detectSecret(value, loc, findings = []) {
  const suspiciousKey = /(?:api[_-]?key|apikey|token|secret|password|private[_-]?key|webhook[_-]?url|bearer)/i;
  const secretValue = /(sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}|Bearer [A-Za-z0-9._-]{20,}|[A-Za-z0-9+/=_-]{48,})/;
  if (Array.isArray(value)) {
    value.forEach((item, index) => detectSecret(item, `${loc}[${index}]`, findings));
  } else if (isPlainObject(value)) {
    for (const [key, nested] of Object.entries(value)) {
      const nestedLoc = `${loc}.${key}`;
      const envKey = /_env$/i.test(key);
      if (suspiciousKey.test(key) && !(envKey && isEnvRef(nested))) findings.push({ path: nestedLoc, reason: 'secret-looking key' });
      detectSecret(nested, nestedLoc, findings);
    }
  } else if (typeof value === 'string') {
    if (secretValue.test(value) && !isEnvRef(value)) findings.push({ path: loc, reason: 'secret-looking value' });
  }
  return findings;
}

function loadProfile(profilePath) {
  if (!fs.existsSync(profilePath)) throw new Error(`profile not found: ${path.relative(ROOT, profilePath)}`);
  let profile;
  try { profile = JSON.parse(fs.readFileSync(profilePath, 'utf8')); }
  catch (err) { throw new Error(`invalid JSON in profile: ${err.message}`); }
  if (!isPlainObject(profile)) throw new Error('profile must be a JSON object');
  if (profile.schema_version !== 'baton.local_profile.v1') throw new Error('schema_version must be baton.local_profile.v1');
  if (profile.tasks && !Array.isArray(profile.tasks)) throw new Error('tasks must be an array');
  if (profile.agents && !Array.isArray(profile.agents)) throw new Error('agents must be an array');
  const secretFindings = detectSecret(profile, 'profile');
  if (secretFindings.length) {
    const first = secretFindings[0];
    throw new Error(`secret-like profile content rejected at ${first.path}: ${first.reason}`);
  }
  return profile;
}

function validateUnknown(obj, allowed, loc) {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) throw new Error(`${loc}.${key} is not an allowed field`);
  }
}

function validateStringArray(value, loc) {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) throw new Error(`${loc} must be an array of strings`);
  return value;
}

function validateObject(value, loc) {
  if (!isPlainObject(value)) throw new Error(`${loc} must be an object`);
  return value;
}

function finiteNumber(value, min, max, loc) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${loc} must be a finite number`);
  return Math.max(min, Math.min(max, n));
}

function validateTask(raw, index, domains) {
  if (!isPlainObject(raw)) throw new Error(`tasks[${index}] must be an object`);
  validateUnknown(raw, TASK_FIELDS, `tasks[${index}]`);
  const task = { ...DEFAULT_TASK, ...raw };
  if (typeof task.title !== 'string' || !task.title.trim()) throw new Error(`tasks[${index}].title is required`);
  if ('id' in task && task.id != null && !/^[A-Za-z0-9_-]+$/.test(String(task.id))) throw new Error(`tasks[${index}].id must be a stable slug`);
  if (!TASK_STATUSES.includes(task.status)) throw new Error(`tasks[${index}].status is invalid`);
  if (!TASK_PRIORITIES.includes(task.priority)) throw new Error(`tasks[${index}].priority is invalid`);
  if (!RISK_LEVELS.includes(task.risk_level)) throw new Error(`tasks[${index}].risk_level is invalid`);
  if (!domains.includes(task.domain)) throw new Error(`tasks[${index}].domain is invalid`);
  for (const field of TASK_ARRAY_FIELDS) task[field] = validateStringArray(task[field], `tasks[${index}].${field}`);
  for (const field of TASK_OBJECT_FIELDS) task[field] = validateObject(task[field], `tasks[${index}].${field}`);
  for (const key of ['impact_score', 'effort_score']) task[key] = finiteNumber(task[key], 0, 10, `tasks[${index}].${key}`);
  task.autonomy_level = finiteNumber(task.autonomy_level, 0, 7, `tasks[${index}].autonomy_level`);
  for (const key of ['confidence_score', 'quality_score', 'fun_score', 'strategic_optionality']) task[key] = finiteNumber(task[key], 0, 1, `tasks[${index}].${key}`);
  for (const key of ['human_touch_minutes', 'agent_hours_unlocked']) task[key] = finiteNumber(task[key], 0, Number.MAX_SAFE_INTEGER, `tasks[${index}].${key}`);
  task.title = task.title.trim();
  return task;
}

function isLocalhostUrl(value) {
  try {
    const url = new URL(value);
    return ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  } catch (_) { return false; }
}

function validateAgent(raw, index, opts) {
  if (!isPlainObject(raw)) throw new Error(`agents[${index}] must be an object`);
  validateUnknown(raw, AGENT_FIELDS, `agents[${index}]`);
  const agent = { ...DEFAULT_AGENT, ...raw };
  if (typeof agent.id !== 'string' || !/^[a-z0-9_-]+$/.test(agent.id)) throw new Error(`agents[${index}].id must be lowercase slug text`);
  if (typeof agent.name !== 'string' || !agent.name.trim()) throw new Error(`agents[${index}].name is required`);
  if (!AGENT_STATUSES.includes(agent.status)) throw new Error(`agents[${index}].status is invalid`);
  for (const field of AGENT_ARRAY_FIELDS) agent[field] = validateStringArray(agent[field], `agents[${index}].${field}`);
  for (const field of AGENT_OBJECT_FIELDS) agent[field] = validateObject(agent[field], `agents[${index}].${field}`);
  agent.dispatch_enabled = Boolean(agent.dispatch_enabled);
  if (agent.dispatch_enabled && (!agent.dispatch_transport || !agent.dispatch_target)) throw new Error(`agents[${index}] dispatch_enabled requires dispatch_transport and dispatch_target`);
  if (agent.dispatch_enabled && agent.dispatch_transport === 'webhook') {
    const target = String(agent.dispatch_target || '');
    if (!isEnvRef(target) && !isLocalhostUrl(target) && !opts.allowExternalDispatchTargets) {
      throw new Error(`agents[${index}].dispatch_target must be an env var name or localhost URL`);
    }
  }
  for (const key of ['quality_score', 'reliability_score']) agent[key] = finiteNumber(agent[key], 0, 1, `agents[${index}].${key}`);
  agent.name = agent.name.trim();
  return agent;
}

function sqlValue(value, label) {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (Array.isArray(value) || isPlainObject(value)) return JSON.stringify(value);
  if (['string', 'number', 'bigint'].includes(typeof value) || value === null || Buffer.isBuffer(value)) return value;
  throw new Error(`${label || 'value'} cannot be stored in SQLite`);
}

function importTasks(db, tasks, opts) {
  let inserted = 0;
  let updated = 0;
  const insertFields = ['id', ...Object.keys(DEFAULT_TASK), 'title'];
  const insert = db.prepare(`INSERT INTO tasks (${insertFields.join(',')}) VALUES (${insertFields.map(() => '?').join(',')})`);
  const updateFields = [...Object.keys(DEFAULT_TASK), 'title'];
  const update = db.prepare(`UPDATE tasks SET ${updateFields.map(key => `${key} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`);
  const seenTitles = new Set();
  for (const task of tasks) {
    const id = task.id || randomUUID();
    const duplicateTitle = db.prepare('SELECT id FROM tasks WHERE lower(title) = lower(?)').get(task.title);
    if (opts.mode === 'insert' && duplicateTitle) throw new Error(`duplicate task title rejected: ${task.title}`);
    if (seenTitles.has(task.title.toLowerCase())) throw new Error(`duplicate task title in profile rejected: ${task.title}`);
    seenTitles.add(task.title.toLowerCase());
    const exists = db.prepare('SELECT id FROM tasks WHERE id = ?').get(id);
    if (exists && opts.mode === 'insert') throw new Error(`duplicate task id rejected: ${id}`);
    if (opts.dryRun) continue;
    if (exists && opts.mode === 'upsert') {
      update.run(...updateFields.map(key => sqlValue(task[key], `task.${key}`)), id);
      updated += 1;
    } else {
      insert.run(...insertFields.map(key => key === 'id' ? id : sqlValue(task[key], `task.${key}`)));
      inserted += 1;
    }
  }
  return { planned: tasks.length, inserted, updated, skipped: opts.dryRun ? tasks.length : 0 };
}

function importAgents(db, agents, opts) {
  let inserted = 0;
  let updated = 0;
  const fields = ['id', ...Object.keys(DEFAULT_AGENT), 'name'];
  const insert = db.prepare(`INSERT INTO agents (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`);
  const updateFields = [...Object.keys(DEFAULT_AGENT), 'name'];
  const update = db.prepare(`UPDATE agents SET ${updateFields.map(key => `${key} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`);
  for (const agent of agents) {
    const exists = db.prepare('SELECT id FROM agents WHERE id = ?').get(agent.id);
    if (exists && opts.mode === 'insert') throw new Error(`duplicate agent id rejected: ${agent.id}`);
    if (opts.dryRun) continue;
    if (exists && opts.mode === 'upsert') {
      update.run(...updateFields.map(key => sqlValue(agent[key], `agent.${key}`)), agent.id);
      updated += 1;
    } else {
      insert.run(...fields.map(key => sqlValue(agent[key], `agent.${key}`)));
      inserted += 1;
    }
  }
  return { planned: agents.length, inserted, updated, skipped: opts.dryRun ? agents.length : 0 };
}

function validateProfileUniqueness(tasks, agents) {
  const titles = new Set();
  const taskIds = new Set();
  for (const task of tasks) {
    const key = task.title.toLowerCase();
    if (titles.has(key)) throw new Error(`duplicate task title in profile rejected: ${task.title}`);
    titles.add(key);
    if (task.id) {
      if (taskIds.has(task.id)) throw new Error(`duplicate task id in profile rejected: ${task.id}`);
      taskIds.add(task.id);
    }
  }
  const agentIds = new Set();
  for (const agent of agents) {
    if (agentIds.has(agent.id)) throw new Error(`duplicate agent id in profile rejected: ${agent.id}`);
    agentIds.add(agent.id);
  }
}

function outputReport(report, json) {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log('BATON local profile import');
  console.log(`profile: ${report.profile}`);
  console.log(`mode: ${report.mode}${report.dry_run ? ' (dry-run)' : ''}`);
  console.log(`db: ${report.db}`);
  console.log('\nvalidated: yes');
  console.log(`tasks: ${report.tasks.planned} planned, ${report.tasks.inserted} inserted, ${report.tasks.updated} updated, ${report.tasks.skipped} skipped`);
  console.log(`agents: ${report.agents.planned} planned, ${report.agents.inserted} inserted, ${report.agents.updated} updated, ${report.agents.skipped} skipped`);
  console.log(`warnings: ${report.warnings.length}`);
  for (const warning of report.warnings) console.log(`- ${warning}`);
}

function main() {
  try {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
      console.log(usage());
      return;
    }
    const profile = loadProfile(opts.profile);
    let db = null;
    let domains = DEFAULT_DOMAINS;
    if (!opts.dryRun) {
      db = require('../server/db');
      domains = db.prepare('SELECT id FROM portfolio_domains').all().map(row => row.id);
    }
    const tasks = (profile.tasks || []).map((task, index) => validateTask(task, index, domains));
    const agents = (profile.agents || []).map((agent, index) => validateAgent(agent, index, opts));
    validateProfileUniqueness(tasks, agents);
    const warnings = [];
    tasks.forEach((task, index) => { if ((task.description || '').length > 500) warnings.push(`tasks[${index}].description is long; consider using context_key for private details.`); });
    const result = opts.dryRun
      ? {
          tasks: { planned: tasks.length, inserted: 0, updated: 0, skipped: tasks.length },
          agents: { planned: agents.length, inserted: 0, updated: 0, skipped: agents.length },
        }
      : db.transaction(() => ({
          tasks: importTasks(db, tasks, opts),
          agents: importAgents(db, agents, opts),
        }))();
    if (!opts.dryRun) require('../server/lib/flow/rebuild').rebuildTouches(db);
    outputReport({
      profile: path.relative(ROOT, opts.profile),
      mode: opts.mode,
      dry_run: opts.dryRun,
      db: process.env.BATON_DB_PATH || path.join('data', 'vmc.db'),
      validated: true,
      warnings,
      ...result,
    }, opts.json);
  } catch (err) {
    console.error(`import-local-profile failed: ${err.message}`);
    process.exit(1);
  }
}

main();
