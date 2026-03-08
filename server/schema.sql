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
