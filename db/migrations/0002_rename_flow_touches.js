'use strict';

/**
 * Rename legacy Flow attention table baton_touches → flow_touches.
 * No-op when schema.sql already created flow_touches (greenfield).
 */
module.exports = function renameFlowTouches(db) {
  const tables = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name)
  );

  if (tables.has('baton_touches') && !tables.has('flow_touches')) {
    db.exec('ALTER TABLE baton_touches RENAME TO flow_touches');
  }

  if (!tables.has('flow_touches') && !tables.has('baton_touches')) {
    // Extreme empty DB without schema.sql — create minimal legacy shell so later migrations can proceed.
    db.exec(`
      CREATE TABLE IF NOT EXISTS flow_touches (
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
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `);
  }

  const touchCols = new Set(
    db.prepare('PRAGMA table_info(flow_touches)').all().map((c) => c.name)
  );

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_flow_touches_status_rank
      ON flow_touches(status, ${touchCols.has('rank') ? 'rank' : 'created_at'}, created_at);
    CREATE INDEX IF NOT EXISTS idx_flow_touches_task_id
      ON flow_touches(task_id);
  `);
  if (touchCols.has('review_packet_id')) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_flow_touches_review_packet_id
        ON flow_touches(review_packet_id);
    `);
  }
};
