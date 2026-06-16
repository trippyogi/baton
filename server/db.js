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
  if (!cols.includes('task_id'))       db.exec('ALTER TABLE runs ADD COLUMN task_id TEXT');
  if (!cols.includes('touch_id'))      db.exec('ALTER TABLE runs ADD COLUMN touch_id TEXT');
  if (!cols.includes('agent_id'))      db.exec('ALTER TABLE runs ADD COLUMN agent_id TEXT');
  if (!cols.includes('dispatch_status'))    db.exec("ALTER TABLE runs ADD COLUMN dispatch_status TEXT DEFAULT 'not_configured'");
  if (!cols.includes('dispatch_transport')) db.exec('ALTER TABLE runs ADD COLUMN dispatch_transport TEXT');
  if (!cols.includes('dispatch_target'))    db.exec('ALTER TABLE runs ADD COLUMN dispatch_target TEXT');
  if (!cols.includes('dispatch_payload'))   db.exec("ALTER TABLE runs ADD COLUMN dispatch_payload TEXT DEFAULT '{}'");
  if (!cols.includes('external_run_id'))    db.exec('ALTER TABLE runs ADD COLUMN external_run_id TEXT');
  if (!cols.includes('acknowledged_at'))    db.exec('ALTER TABLE runs ADD COLUMN acknowledged_at TEXT');
  if (!cols.includes('last_status_at'))     db.exec('ALTER TABLE runs ADD COLUMN last_status_at TEXT');
  if (!cols.includes('review_packet_id'))   db.exec('ALTER TABLE runs ADD COLUMN review_packet_id TEXT');
  if (!cols.includes('error'))              db.exec('ALTER TABLE runs ADD COLUMN error TEXT');

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

  const agentCols = db.prepare('PRAGMA table_info(agents)').all().map(c => c.name);
  if (!agentCols.includes('dispatch_enabled'))   db.exec('ALTER TABLE agents ADD COLUMN dispatch_enabled INTEGER NOT NULL DEFAULT 0');
  if (!agentCols.includes('dispatch_transport')) db.exec("ALTER TABLE agents ADD COLUMN dispatch_transport TEXT DEFAULT 'manual'");
  if (!agentCols.includes('dispatch_target'))    db.exec('ALTER TABLE agents ADD COLUMN dispatch_target TEXT');
  if (!agentCols.includes('dispatch_config'))    db.exec("ALTER TABLE agents ADD COLUMN dispatch_config TEXT DEFAULT '{}'");

  const packetCols = db.prepare('PRAGMA table_info(review_packets)').all().map(c => c.name);
  if (!packetCols.includes('schema_version')) db.exec("ALTER TABLE review_packets ADD COLUMN schema_version TEXT DEFAULT 'baton.review_packet.v1'");
  if (!packetCols.includes('sections'))       db.exec("ALTER TABLE review_packets ADD COLUMN sections TEXT DEFAULT '[]'");
  if (!packetCols.includes('artifacts'))      db.exec("ALTER TABLE review_packets ADD COLUMN artifacts TEXT DEFAULT '[]'");

  db.exec(`
    CREATE TABLE IF NOT EXISTS strategy_packets (
      id TEXT PRIMARY KEY,
      goal TEXT NOT NULL,
      raw_input TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'drafted',
      notes TEXT DEFAULT '',
      created_by TEXT DEFAULT 'operator',
      task_ids TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS formal_specs (
      id TEXT PRIMARY KEY,
      packet_id TEXT,
      project TEXT NOT NULL,
      target_repository TEXT DEFAULT '',
      spec_version TEXT DEFAULT '',
      selected_phase TEXT DEFAULT '',
      include_all_phases INTEGER NOT NULL DEFAULT 0,
      markdown TEXT NOT NULL,
      parsed_json TEXT NOT NULL DEFAULT '{}',
      created_by TEXT DEFAULT 'operator',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(packet_id) REFERENCES strategy_packets(id)
    );
  `);

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

  const spectreDispatchConfig = {
    transport: 'webhook',
    url_env: 'SPECTRE_WEBHOOK_URL',
    token_env: 'SPECTRE_DISPATCH_TOKEN',
    timeout_ms: 10000,
  };
  db.prepare(`
    INSERT OR IGNORE INTO agents (
      id, name, type, status, skills, permissions,
      dispatch_enabled, dispatch_transport, dispatch_target, dispatch_config
    ) VALUES (?, ?, ?, 'idle', ?, ?, 1, 'webhook', 'SPECTRE_WEBHOOK_URL', ?)
  `).run(
    'spectre',
    'Spectre',
    'orchestrator',
    JSON.stringify(['orchestration', 'strategy', 'research', 'coordination', 'revenue', 'launch']),
    JSON.stringify(defaultAgentPermissions('spectre')),
    JSON.stringify(spectreDispatchConfig)
  );
  db.prepare(`
    UPDATE agents
    SET dispatch_enabled = 1, dispatch_transport = 'webhook', dispatch_target = 'SPECTRE_WEBHOOK_URL', dispatch_config = ?
    WHERE id = 'spectre'
  `).run(JSON.stringify(spectreDispatchConfig));
})();

function defaultAgentPermissions(agentId) {
  return {
    github: { repos: ['owner/baton'], can_push_branch: true, can_merge: false },
    spend: { daily_limit_usd: 0 },
    external_messages: { draft_only: true },
    public_posting: false,
    production_changes: false,
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
    insertTask.run({ id:id(), title:'Review agent output packet', description:'Inspect a generic review packet and decide whether to accept, refine, or delegate follow-up.', status:'review', priority:'high', owner:'operator', tags:'["review","agent"]', impact:8, effort:2 });
    insertTask.run({ id:id(), title:'Prioritize next product polish task', description:'Choose the highest leverage polish item for the next product iteration.', status:'ready', priority:'high', owner:'operator', tags:'["product","triage"]', impact:7, effort:3 });
    insertTask.run({ id:id(), title:'Draft launch checklist follow-up', description:'Turn a launch checklist gap into a clear next human touch or agent assignment.', status:'ready', priority:'medium', owner:'operator', tags:'["launch","checklist"]', impact:6, effort:2 });
    insertTask.run({ id:id(), title:'Triage stale waiting run', description:'Review a waiting run and decide whether to unblock, refine, snooze, or archive it.', status:'waiting', priority:'medium', owner:'operator', tags:'["ops","triage"]', impact:5, effort:2 });
    insertTask.run({ id:id(), title:'Refine implementation spec for code agent', description:'Clarify acceptance criteria before assigning implementation work to a code agent.', status:'backlog', priority:'medium', owner:'operator', tags:'["engineering","spec"]', impact:7, effort:4 });
    insertTask.run({ id:id(), title:'Validate private local use boundary', description:'Confirm local operator data stays outside tracked public repository files.', status:'in_progress', priority:'critical', owner:'operator', tags:'["security","privacy"]', impact:10, effort:5 });
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
    insertAlert.run({ id:id(), type:'flow', severity:'warning', message:'One review touch has been waiting long enough to deserve operator attention.' });
    insertAlert.run({ id:id(), type:'budget', severity:'info', message:'Demo provider usage is within the configured local budget.' });
    insertAlert.run({ id:id(), type:'privacy', severity:'info', message:'Keep real operator tasks in ignored local files or the local SQLite database.' });
  });
  seedAlerts();

  const today = new Date().toISOString().slice(0,10);
  const seedUsage = db.transaction(() => {
    insertUsage.run({ provider:'anthropic', day:today, cost:0.102, tokens:31400, requests:8 });
    insertUsage.run({ provider:'gemini', day:today, cost:0.018, tokens:4200, requests:2 });
    insertUsage.run({ provider:'demo-worker', day:today, cost:0.044, tokens:0, requests:12 });
    insertUsage.run({ provider:'hosting', day:today, cost:0.48, tokens:0, requests:0 });
  });
  seedUsage();
}

module.exports = db;
