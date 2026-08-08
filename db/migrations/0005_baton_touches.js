'use strict';

/**
 * Canonical BatonTouch attention projection (T3.2 / design.md §3.5).
 * Empty on apply; legacy Flow rows live in flow_touches until T3.8.
 *
 * Guard: refuse to treat a legacy Flow-shaped baton_touches as canonical.
 */
module.exports = function createBatonTouches(db) {
  const existing = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'baton_touches'")
    .get();

  if (existing) {
    const cols = new Set(db.prepare('PRAGMA table_info(baton_touches)').all().map((c) => c.name));
    if (!cols.has('dedupe_key') || !cols.has('kind') || !cols.has('source_type')) {
      throw new Error(
        'baton_touches exists with legacy Flow columns; run 0002_rename_flow_touches first'
      );
    }
  } else {
    db.exec(`
      CREATE TABLE baton_touches (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_version INTEGER NOT NULL,
        task_id TEXT,
        run_id TEXT,
        status TEXT NOT NULL DEFAULT 'open'
          CHECK (status IN ('open', 'snoozed', 'resolved', 'superseded', 'cancelled')),
        assignee_id TEXT,
        seen_at TEXT,
        snoozed_until TEXT,
        rank_score REAL NOT NULL DEFAULT 0,
        rank_explanation_json TEXT NOT NULL DEFAULT '{}',
        manual_rank_override REAL,
        work_mode TEXT,
        opened_at TEXT NOT NULL,
        due_at TEXT,
        escalated_at TEXT,
        resolved_at TEXT,
        resolved_by TEXT,
        resolution_event_id TEXT,
        source_event_id TEXT NOT NULL,
        dedupe_key TEXT NOT NULL UNIQUE,
        opened_snapshot_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY (task_id) REFERENCES tasks(id),
        FOREIGN KEY (run_id) REFERENCES runs(id)
      );
    `);
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_baton_touches_queue
      ON baton_touches(status, rank_score DESC, due_at, opened_at);
    CREATE INDEX IF NOT EXISTS idx_baton_touches_source
      ON baton_touches(source_type, source_id, source_version);
    CREATE INDEX IF NOT EXISTS idx_baton_touches_task
      ON baton_touches(task_id);
  `);
};
