-- Canonical domain tables (T3.1). Non-destructive; legacy tables remain.

CREATE TABLE IF NOT EXISTS decision_requests (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  question TEXT NOT NULL,
  context_json TEXT NOT NULL DEFAULT '{}',
  options_json TEXT NOT NULL DEFAULT '[]',
  requester TEXT NOT NULL DEFAULT 'system',
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'answered', 'cancelled')),
  response_json TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  answered_at TEXT,
  cancelled_at TEXT,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id TEXT NOT NULL,
  depends_on_task_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (task_id, depends_on_task_id),
  CHECK (task_id <> depends_on_task_id),
  FOREIGN KEY (task_id) REFERENCES tasks(id),
  FOREIGN KEY (depends_on_task_id) REFERENCES tasks(id)
);

CREATE TABLE IF NOT EXISTS task_blockers (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  run_id TEXT,
  source_packet_id TEXT,
  reason_code TEXT NOT NULL,
  summary TEXT NOT NULL,
  questions_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolution_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (task_id) REFERENCES tasks(id),
  FOREIGN KEY (run_id) REFERENCES runs(id)
);

CREATE TABLE IF NOT EXISTS task_rank_explanations (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  algorithm_version TEXT NOT NULL,
  score INTEGER NOT NULL,
  factors_json TEXT NOT NULL DEFAULT '{}',
  blocked_reasons_json TEXT NOT NULL DEFAULT '[]',
  summary TEXT NOT NULL DEFAULT '',
  calculated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

CREATE TABLE IF NOT EXISTS dispatches (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  adapter_type TEXT NOT NULL,
  endpoint_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  idempotency_key TEXT NOT NULL UNIQUE,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  claim_token TEXT,
  next_attempt_at TEXT,
  delivered_at TEXT,
  ack_deadline_at TEXT,
  acknowledged_at TEXT,
  callback_secret_hash TEXT,
  callback_secret_expires_at TEXT,
  last_error_code TEXT,
  last_error_message TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (run_id) REFERENCES runs(id)
);

CREATE TABLE IF NOT EXISTS dispatch_attempts (
  attempt_id TEXT PRIMARY KEY,
  dispatch_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('started', 'accepted', 'retryable_error', 'permanent_error')),
  request_id TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  http_status INTEGER,
  transport_message_id TEXT,
  error_code TEXT,
  error_message TEXT,
  UNIQUE (dispatch_id, attempt_number),
  FOREIGN KEY (dispatch_id) REFERENCES dispatches(id)
);

CREATE TABLE IF NOT EXISTS run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  source TEXT NOT NULL,
  source_sequence INTEGER,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  payload_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (run_id) REFERENCES runs(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_run_events_source_sequence
  ON run_events(run_id, source, source_sequence)
  WHERE source_sequence IS NOT NULL;

CREATE TABLE IF NOT EXISTS run_diagnostics (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  kind TEXT NOT NULL
    CHECK (kind IN ('invalid_output', 'executor_failure', 'migration')),
  error_codes_json TEXT NOT NULL DEFAULT '[]',
  redacted_excerpt TEXT,
  artifact_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  access_level TEXT NOT NULL DEFAULT 'operator'
    CHECK (access_level IN ('operator', 'extension')),
  FOREIGN KEY (run_id) REFERENCES runs(id)
);

CREATE TABLE IF NOT EXISTS review_decisions (
  id TEXT PRIMARY KEY,
  review_packet_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  decision TEXT NOT NULL
    CHECK (decision IN ('approve', 'request_changes', 'reject')),
  reason TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  expected_task_version INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (review_packet_id) REFERENCES review_packets(id),
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  uri TEXT NOT NULL,
  sha256 TEXT,
  size_bytes INTEGER,
  media_type TEXT,
  retention_policy TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (run_id) REFERENCES runs(id)
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  event_type TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  payload_hash TEXT,
  UNIQUE (provider, delivery_id)
);

CREATE TABLE IF NOT EXISTS agent_endpoints (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  adapter_type TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  base_url TEXT,
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  supported_contract_ids_json TEXT NOT NULL DEFAULT '[]',
  auth_ref TEXT,
  config_json TEXT NOT NULL DEFAULT '{}',
  last_heartbeat_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One non-terminal run per task / linear lineage unique indexes are deferred to
-- T3.3 transition services after legacy multi-run rows are cleaned. Non-unique
-- helpers still support lookups during the compatibility window.
CREATE INDEX IF NOT EXISTS idx_runs_task_status
  ON runs(task_id, status);

CREATE INDEX IF NOT EXISTS idx_runs_parent_run_id
  ON runs(parent_run_id);

CREATE INDEX IF NOT EXISTS idx_dispatches_due
  ON dispatches(status, next_attempt_at);

CREATE INDEX IF NOT EXISTS idx_task_blockers_open
  ON task_blockers(task_id, status);

CREATE INDEX IF NOT EXISTS idx_artifacts_run_created
  ON artifacts(run_id, created_at);

CREATE INDEX IF NOT EXISTS idx_decision_requests_status
  ON decision_requests(status, updated_at);
