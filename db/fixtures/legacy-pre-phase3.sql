-- Minimal pre-Phase-3 legacy schema fixture (Flow-era baton_touches).
-- Used by scripts/test-migrations.js; must not fabricate ACK/review history.

PRAGMA foreign_keys=ON;

CREATE TABLE tasks (
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

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  agent_name TEXT DEFAULT 'vector',
  status TEXT DEFAULT 'pending',
  task_id TEXT,
  cost REAL DEFAULT 0,
  tokens INTEGER DEFAULT 0,
  started_at TEXT,
  ended_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE review_packets (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  run_id TEXT,
  goal TEXT NOT NULL DEFAULT '',
  summary TEXT DEFAULT '',
  schema_version TEXT DEFAULT 'baton.review_packet.v1',
  packet_status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE baton_touches (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  run_id TEXT,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  primary_action TEXT NOT NULL,
  score INTEGER DEFAULT 0,
  rank INTEGER,
  source TEXT DEFAULT 'generated',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(task_id) REFERENCES tasks(id)
);

INSERT INTO tasks (id, title, description, status, impact_score, effort_score)
VALUES ('task-legacy-1', 'Legacy fixture task', 'Preserve me', 'ready', 7, 3);

INSERT INTO baton_touches (id, task_id, title, type, status, primary_action, score, rank, source)
VALUES ('touch-legacy-1', 'task-legacy-1', 'Review fixture', 'review', 'pending', 'approve', 10, 1, 'generated');
