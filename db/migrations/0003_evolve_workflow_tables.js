'use strict';

function addColumnIfMissing(db, table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

/**
 * Evolve legacy tasks/runs/review_packets toward canonical columns (non-destructive).
 */
module.exports = function evolveWorkflowTables(db) {
  const tables = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name)
  );

  if (tables.has('tasks')) {
    addColumnIfMissing(db, 'tasks', 'objective', "objective TEXT NOT NULL DEFAULT ''");
    addColumnIfMissing(db, 'tasks', 'version', 'version INTEGER NOT NULL DEFAULT 1');
    addColumnIfMissing(db, 'tasks', 'archived_at', 'archived_at TEXT');
    addColumnIfMissing(db, 'tasks', 'urgency', 'urgency INTEGER NOT NULL DEFAULT 5');
    addColumnIfMissing(db, 'tasks', 'acceptance_criteria_json', "acceptance_criteria_json TEXT NOT NULL DEFAULT '[]'");
    addColumnIfMissing(db, 'tasks', 'why_now_json', "why_now_json TEXT NOT NULL DEFAULT '{}'");
    addColumnIfMissing(db, 'tasks', 'current_run_id', 'current_run_id TEXT');
    addColumnIfMissing(db, 'tasks', 'legacy_payload_json', "legacy_payload_json TEXT NOT NULL DEFAULT '{}'");
    addColumnIfMissing(db, 'tasks', 'owner_id', 'owner_id TEXT');
    addColumnIfMissing(db, 'tasks', 'manual_boost', 'manual_boost INTEGER NOT NULL DEFAULT 0');
    addColumnIfMissing(db, 'tasks', 'rank_score', 'rank_score INTEGER NOT NULL DEFAULT 0');
    // Backfill objective from description when empty
    db.exec(`
      UPDATE tasks
      SET objective = description
      WHERE (objective IS NULL OR objective = '')
        AND description IS NOT NULL
        AND description != ''
    `);
    db.exec(`
      UPDATE tasks
      SET owner_id = owner
      WHERE owner_id IS NULL AND owner IS NOT NULL
    `);
  }

  if (tables.has('runs')) {
    addColumnIfMissing(db, 'runs', 'parent_run_id', 'parent_run_id TEXT');
    addColumnIfMissing(db, 'runs', 'attempt_number', 'attempt_number INTEGER NOT NULL DEFAULT 1');
    addColumnIfMissing(db, 'runs', 'kind', "kind TEXT NOT NULL DEFAULT 'execute'");
    addColumnIfMissing(db, 'runs', 'result_kind', 'result_kind TEXT');
    addColumnIfMissing(db, 'runs', 'version', 'version INTEGER NOT NULL DEFAULT 1');
    addColumnIfMissing(db, 'runs', 'input_snapshot_json', "input_snapshot_json TEXT NOT NULL DEFAULT '{}'");
    addColumnIfMissing(db, 'runs', 'policy_json', "policy_json TEXT NOT NULL DEFAULT '{}'");
    addColumnIfMissing(db, 'runs', 'agent_endpoint_id', 'agent_endpoint_id TEXT');
    addColumnIfMissing(db, 'runs', 'agent_run_id', 'agent_run_id TEXT');
    addColumnIfMissing(db, 'runs', 'current_dispatch_id', 'current_dispatch_id TEXT');
    addColumnIfMissing(db, 'runs', 'failure_code', 'failure_code TEXT');
    addColumnIfMissing(db, 'runs', 'failure_message', 'failure_message TEXT');
    addColumnIfMissing(db, 'runs', 'cost_usd', 'cost_usd REAL NOT NULL DEFAULT 0');
    addColumnIfMissing(db, 'runs', 'token_usage_json', "token_usage_json TEXT NOT NULL DEFAULT '{}'");
    addColumnIfMissing(db, 'runs', 'updated_at', "updated_at TEXT NOT NULL DEFAULT (datetime('now'))");
    db.exec(`
      UPDATE runs
      SET cost_usd = COALESCE(cost, 0)
      WHERE cost_usd = 0 AND cost IS NOT NULL AND cost != 0
    `);
  }

  if (tables.has('review_packets')) {
    addColumnIfMissing(db, 'review_packets', 'version', 'version INTEGER NOT NULL DEFAULT 1');
    addColumnIfMissing(db, 'review_packets', 'acceptance_criteria_json', "acceptance_criteria_json TEXT NOT NULL DEFAULT '[]'");
    addColumnIfMissing(db, 'review_packets', 'checks_json', "checks_json TEXT NOT NULL DEFAULT '[]'");
    addColumnIfMissing(db, 'review_packets', 'known_gaps_json', "known_gaps_json TEXT NOT NULL DEFAULT '[]'");
    addColumnIfMissing(db, 'review_packets', 'recommended_decision', 'recommended_decision TEXT');
    addColumnIfMissing(db, 'review_packets', 'submitted_at', 'submitted_at TEXT');
    addColumnIfMissing(db, 'review_packets', 'validated_at', 'validated_at TEXT');
  }
};
