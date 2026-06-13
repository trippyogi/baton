'use strict';
const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const DB_PATH = process.env.BATON_DB_PATH || path.join(__dirname, '..', 'data', 'vmc.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// Apply schema
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// ── Inline migrations (idempotent column additions) ───────────────────────────
(function runMigrations() {
  const cols = db.prepare('PRAGMA table_info(runs)').all().map(c => c.name);
  if (!cols.includes('worker_type'))   db.exec('ALTER TABLE runs ADD COLUMN worker_type TEXT DEFAULT NULL');
  if (!cols.includes('fix_attempts'))  db.exec('ALTER TABLE runs ADD COLUMN fix_attempts INTEGER NOT NULL DEFAULT 0');
  if (!cols.includes('base_branch'))   db.exec('ALTER TABLE runs ADD COLUMN base_branch TEXT');
  if (!cols.includes('repo'))          db.exec('ALTER TABLE runs ADD COLUMN repo TEXT');
  if (!cols.includes('output_path'))   db.exec('ALTER TABLE runs ADD COLUMN output_path TEXT');
  if (!cols.includes('output_preview'))db.exec('ALTER TABLE runs ADD COLUMN output_preview TEXT');

  const touchCols = db.prepare('PRAGMA table_info(baton_touches)').all().map(c => c.name);
  if (!touchCols.includes('manual_priority_boost')) db.exec('ALTER TABLE baton_touches ADD COLUMN manual_priority_boost REAL DEFAULT 0');
  if (!touchCols.includes('pinned'))                db.exec('ALTER TABLE baton_touches ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0');
  if (!touchCols.includes('manual_override_until')) db.exec('ALTER TABLE baton_touches ADD COLUMN manual_override_until TEXT');

  const taskCols = db.prepare('PRAGMA table_info(tasks)').all().map(c => c.name);
  if (!taskCols.includes('domain'))                 db.exec("ALTER TABLE tasks ADD COLUMN domain TEXT DEFAULT 'product'");
  if (!taskCols.includes('project_key'))            db.exec('ALTER TABLE tasks ADD COLUMN project_key TEXT');
  if (!taskCols.includes('context_key'))            db.exec('ALTER TABLE tasks ADD COLUMN context_key TEXT');
  if (!taskCols.includes('autonomy_level'))         db.exec('ALTER TABLE tasks ADD COLUMN autonomy_level INTEGER DEFAULT 1');
  if (!taskCols.includes('risk_level'))             db.exec("ALTER TABLE tasks ADD COLUMN risk_level TEXT DEFAULT 'low'");
  if (!taskCols.includes('quality_gate'))           db.exec("ALTER TABLE tasks ADD COLUMN quality_gate TEXT DEFAULT 'general'");
  if (!taskCols.includes('spec_quality'))           db.exec("ALTER TABLE tasks ADD COLUMN spec_quality TEXT DEFAULT 'unknown'");
  if (!taskCols.includes('human_touch_minutes'))    db.exec('ALTER TABLE tasks ADD COLUMN human_touch_minutes INTEGER DEFAULT 5');
  if (!taskCols.includes('agent_hours_unlocked'))   db.exec('ALTER TABLE tasks ADD COLUMN agent_hours_unlocked REAL DEFAULT 0.5');
  if (!taskCols.includes('confidence_score'))       db.exec('ALTER TABLE tasks ADD COLUMN confidence_score REAL DEFAULT 0.7');
  if (!taskCols.includes('quality_score'))          db.exec('ALTER TABLE tasks ADD COLUMN quality_score REAL DEFAULT 0.7');
  if (!taskCols.includes('fun_score'))              db.exec('ALTER TABLE tasks ADD COLUMN fun_score REAL DEFAULT 0.0');
  if (!taskCols.includes('strategic_optionality'))  db.exec('ALTER TABLE tasks ADD COLUMN strategic_optionality REAL DEFAULT 0.0');

  // Migration: shared_requests table (2026-02-27)
  db.exec(`
    CREATE TABLE IF NOT EXISTS shared_requests (
      id TEXT PRIMARY KEY,
      from_user TEXT NOT NULL,
      to_user TEXT NOT NULL,
      request TEXT NOT NULL,
      artifact_url TEXT,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  const domains = [
    ['revenue', 'Revenue', 1.40, 0, 14],
    ['product', 'Product', 1.30, 0, 14],
    ['code', 'Code', 1.10, 0, 14],
    ['content', 'Content', 1.05, 0, 14],
    ['personal_brand', 'Personal Brand', 1.00, 1, 14],
    ['relationships', 'Relationships', 1.00, 1, 14],
    ['health_life', 'Health / Life', 1.00, 1, 14],
    ['creative_exploration', 'Creative Exploration', 0.95, 0, 14],
    ['learning', 'Learning', 0.90, 0, 14],
    ['fun', 'Fun', 0.85, 0, 14],
    ['maintenance', 'Maintenance', 0.80, 0, 14],
    ['admin', 'Admin', 0.70, 0, 14],
  ];
  const insertDomain = db.prepare(`
    INSERT OR IGNORE INTO portfolio_domains (id, label, weight, protected_minimum, starvation_days)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const domain of domains) insertDomain.run(...domain);

  const agents = [
    ['code-agent', 'Code Agent', 'code', ['javascript', 'express', 'sqlite', 'frontend', 'api']],
    ['research-agent', 'Research Agent', 'research', ['research', 'synthesis', 'market']],
    ['copy-agent', 'Copy Agent', 'copy', ['copy', 'content', 'brand', 'email']],
    ['design-agent', 'Design Agent', 'design', ['design', 'visual', 'creative']],
    ['strategy-agent', 'Strategy Agent', 'strategy', ['strategy', 'product', 'revenue']],
    ['evaluator-agent', 'Evaluator Agent', 'evaluator', ['review', 'quality', 'evaluator']],
    ['ops-agent', 'Ops Agent', 'ops', ['ops', 'admin', 'maintenance']],
  ];
  const insertAgent = db.prepare(`
    INSERT OR IGNORE INTO agents (id, name, type, status, skills, permissions)
    VALUES (?, ?, ?, 'idle', ?, ?)
  `);
  for (const agent of agents) {
    insertAgent.run(agent[0], agent[1], agent[2], JSON.stringify(agent[3]), JSON.stringify(defaultAgentPermissions(agent[0])));
  }
})();

function defaultAgentPermissions(agentId) {
  return {
    github: { repos: ['trippyogi/baton'], can_push_branch: true, can_merge: false },
    spend: { daily_limit_usd: 0 },
    external_messages: { draft_only: true },
    agent_id: agentId,
  };
}

// Seed mock data if tables are empty
const taskCount = db.prepare('SELECT COUNT(*) as n FROM tasks').get().n;
if (taskCount === 0) {
  const id = () => require('crypto').randomUUID();

  const insertTask = db.prepare(`
    INSERT INTO tasks (id,title,description,status,priority,owner,tags,impact_score,effort_score)
    VALUES (@id,@title,@description,@status,@priority,@owner,@tags,@impact,@effort)
  `);
  const insertRun = db.prepare(`
    INSERT INTO runs (id,agent_name,status,cost,tokens,started_at,ended_at)
    VALUES (@id,@agent,@status,@cost,@tokens,@started,@ended)
  `);
  const insertAlert = db.prepare(`
    INSERT INTO alerts (id,type,severity,message) VALUES (@id,@type,@severity,@message)
  `);
  const insertUsage = db.prepare(`
    INSERT INTO provider_usage (provider,day,cost,tokens,requests)
    VALUES (@provider,@day,@cost,@tokens,@requests)
  `);

  const seedTasks = db.transaction(() => {
    insertTask.run({ id:id(), title:'Set up ATC retargeting campaign', description:'$15/day Dynamic Product Ads for L3 Assembly ATCs', status:'ready', priority:'high', owner:'jeremy', tags:'["meta","ads"]', impact:9, effort:2 });
    insertTask.run({ id:id(), title:'MeldMaster carousel copy', description:'Write captions using lore from character-briefs/meldmaster-lore.md', status:'in_progress', priority:'high', owner:'vector', tags:'["content","carousel"]', impact:7, effort:3 });
    insertTask.run({ id:id(), title:'Build 1% LAL campaign', description:'180d purchasers/ATC source, $20/day, target US', status:'ready', priority:'high', owner:'jeremy', tags:'["meta","ads"]', impact:8, effort:2 });
    insertTask.run({ id:id(), title:'Fix Email 2 CTA in abandoned cart', description:'"View cart" → "Complete My Order"', status:'done', priority:'low', owner:'vector', tags:'["email"]', impact:4, effort:1 });
    insertTask.run({ id:id(), title:'Fill 14 remaining character briefs', description:'From 4Horseman email threads', status:'backlog', priority:'medium', owner:'vector', tags:'["content"]', impact:6, effort:8 });
    insertTask.run({ id:id(), title:'BATON Flow Ops Phase 1', description:'Flow, Tasks, Airspace, Runs, Alerts', status:'in_progress', priority:'critical', owner:'circuit', tags:'["engineering","flow"]', impact:10, effort:7 });
  });
  seedTasks();

  const seedRuns = db.transaction(() => {
    insertRun.run({ id:id(), agent:'vector', status:'completed', cost:0.043, tokens:12400, started:'2026-02-21T00:10:00Z', ended:'2026-02-21T00:14:22Z' });
    insertRun.run({ id:id(), agent:'vector', status:'completed', cost:0.021, tokens:6800, started:'2026-02-21T01:05:00Z', ended:'2026-02-21T01:06:44Z' });
    insertRun.run({ id:id(), agent:'circuit', status:'completed', cost:0.038, tokens:11200, started:'2026-02-21T01:12:53Z', ended:'2026-02-21T01:12:57Z' });
    insertRun.run({ id:id(), agent:'vector', status:'running', cost:0, tokens:0, started:'2026-02-21T01:35:00Z', ended:null });
  });
  seedRuns();

  const seedAlerts = db.transaction(() => {
    insertAlert.run({ id:id(), type:'funnel', severity:'warning', message:'L3 Assembly: 54 ATCs → 5 purchases. Funnel leak at checkout.' });
    insertAlert.run({ id:id(), type:'budget', severity:'info', message:'Ad spend on track. $627 last 14d across active campaigns.' });
    insertAlert.run({ id:id(), type:'shipping', severity:'info', message:'Wave 1 figures ETA: warehouse mid-March. Influencer kits this week.' });
  });
  seedAlerts();

  const today = new Date().toISOString().slice(0,10);
  const seedUsage = db.transaction(() => {
    insertUsage.run({ provider:'anthropic', day:today, cost:0.102, tokens:31400, requests:8 });
    insertUsage.run({ provider:'gemini', day:today, cost:0.018, tokens:4200, requests:2 });
    insertUsage.run({ provider:'meta', day:today, cost:44.71, tokens:0, requests:12 });
    insertUsage.run({ provider:'hosting', day:today, cost:0.48, tokens:0, requests:0 });
  });
  seedUsage();
}

module.exports = db;
