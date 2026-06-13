PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT DEFAULT 'inbox',
  priority TEXT DEFAULT 'medium',
  owner TEXT DEFAULT 'vector',
  tags TEXT DEFAULT '[]',
  due_at TEXT,
  linked_run_ids TEXT DEFAULT '[]',
  impact_score INTEGER DEFAULT 0,
  effort_score INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  agent_name TEXT DEFAULT 'vector',
  worker_type TEXT DEFAULT NULL,
  status TEXT DEFAULT 'pending',
  task_id TEXT,
  touch_id TEXT,
  agent_id TEXT,
  dispatch_status TEXT DEFAULT 'not_configured',
  dispatch_transport TEXT,
  dispatch_target TEXT,
  dispatch_payload TEXT DEFAULT '{}',
  external_run_id TEXT,
  acknowledged_at TEXT,
  last_status_at TEXT,
  review_packet_id TEXT,
  error TEXT,
  steps TEXT DEFAULT '[]',
  logs TEXT DEFAULT '[]',
  cost REAL DEFAULT 0,
  tokens INTEGER DEFAULT 0,
  started_at TEXT,
  ended_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS provider_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT,
  day TEXT,
  cost REAL DEFAULT 0,
  tokens INTEGER DEFAULT 0,
  requests INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  type TEXT DEFAULT 'info',
  severity TEXT DEFAULT 'info',
  message TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS memory_docs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT DEFAULT '',
  tags TEXT DEFAULT '[]',
  source_links TEXT DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS builds (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  type TEXT DEFAULT 'tool',
  status TEXT DEFAULT 'shipped',
  path TEXT,
  tags TEXT DEFAULT '[]',
  built_by TEXT DEFAULT 'vector+circuit',
  nightly_date TEXT,
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS flow_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  current_mode TEXT NOT NULL DEFAULT 'triage',
  active_context_key TEXT,
  active_project_key TEXT,
  max_visible_touches INTEGER NOT NULL DEFAULT 7,
  review_debt_limit INTEGER NOT NULL DEFAULT 5,
  agent_wip_limit INTEGER NOT NULL DEFAULT 12,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS portfolio_domains (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  protected_minimum INTEGER NOT NULL DEFAULT 0,
  starvation_days INTEGER NOT NULL DEFAULT 14,
  last_touched_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS baton_touches (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  run_id TEXT,
  agent_id TEXT,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  primary_action TEXT NOT NULL,
  secondary_actions TEXT DEFAULT '[]',
  why_now TEXT DEFAULT '',
  domain TEXT DEFAULT 'product',
  project_key TEXT,
  context_key TEXT,
  mode_fit REAL DEFAULT 0.50,
  portfolio_weight REAL DEFAULT 1.00,
  impact_score INTEGER DEFAULT 5,
  effort_score INTEGER DEFAULT 5,
  urgency_score REAL DEFAULT 0.30,
  confidence_score REAL DEFAULT 0.70,
  quality_score REAL DEFAULT 0.70,
  risk_score REAL DEFAULT 0.30,
  fun_score REAL DEFAULT 0.00,
  strategic_optionality REAL DEFAULT 0.00,
  starvation_score REAL DEFAULT 0.00,
  context_switch_cost REAL DEFAULT 0.50,
  human_touch_minutes INTEGER DEFAULT 5,
  agent_hours_unlocked REAL DEFAULT 0.50,
  autonomy_level INTEGER DEFAULT 1,
  risk_level TEXT DEFAULT 'low',
  review_packet_id TEXT,
  score INTEGER DEFAULT 0,
  rank INTEGER,
  manual_priority_boost REAL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  manual_override_until TEXT,
  source TEXT DEFAULT 'generated',
  generated_at TEXT DEFAULT (datetime('now')),
  last_touched_at TEXT,
  snoozed_until TEXT,
  resolved_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(task_id) REFERENCES tasks(id)
);

CREATE TABLE IF NOT EXISTS touch_events (
  id TEXT PRIMARY KEY,
  touch_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor TEXT DEFAULT 'human',
  payload TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(touch_id) REFERENCES baton_touches(id)
);

INSERT OR IGNORE INTO flow_settings (id, current_mode)
VALUES ('default', 'triage');

CREATE TABLE IF NOT EXISTS review_packets (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  run_id TEXT,
  agent_id TEXT,
  work_type TEXT NOT NULL DEFAULT 'general',
  goal TEXT NOT NULL,
  artifact_url TEXT,
  summary TEXT DEFAULT '',
  changes TEXT DEFAULT '',
  rationale TEXT DEFAULT '',
  evidence TEXT DEFAULT '[]',
  risks TEXT DEFAULT '[]',
  open_questions TEXT DEFAULT '[]',
  suggested_next_action TEXT DEFAULT '',
  schema_version TEXT DEFAULT 'baton.review_packet.v1',
  sections TEXT DEFAULT '[]',
  artifacts TEXT DEFAULT '[]',
  confidence_score REAL DEFAULT 0.70,
  quality_score REAL DEFAULT 0.70,
  packet_status TEXT NOT NULL DEFAULT 'draft',
  validator_notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(task_id) REFERENCES tasks(id)
);

CREATE TABLE IF NOT EXISTS quality_policies (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  policy_type TEXT NOT NULL DEFAULT 'general',
  applies_to TEXT DEFAULT '[]',
  source_touch_id TEXT,
  confidence REAL DEFAULT 0.70,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'general',
  status TEXT NOT NULL DEFAULT 'idle',
  skills TEXT DEFAULT '[]',
  permissions TEXT DEFAULT '{}',
  current_task_id TEXT,
  current_run_id TEXT,
  cost_profile TEXT DEFAULT '{}',
  dispatch_enabled INTEGER NOT NULL DEFAULT 0,
  dispatch_transport TEXT DEFAULT 'manual',
  dispatch_target TEXT,
  dispatch_config TEXT DEFAULT '{}',
  quality_score REAL DEFAULT 0.70,
  reliability_score REAL DEFAULT 0.70,
  last_activity_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
