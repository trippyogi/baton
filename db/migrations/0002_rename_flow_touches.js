'use strict';

function tableExists(db, name) {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)
  );
}

function columnNames(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
}

function isLegacyFlowTouchShape(db, table) {
  const cols = columnNames(db, table);
  return cols.has('title') && cols.has('type') && !cols.has('dedupe_key');
}

function rowCount(db, table) {
  return Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
}

function copyLegacyTouchesIntoFlow(db) {
  const flowCols = columnNames(db, 'flow_touches');
  const legacyCols = columnNames(db, 'baton_touches');
  const common = [...flowCols].filter((c) => legacyCols.has(c));
  if (common.length === 0) {
    throw new Error('No common columns between flow_touches and legacy baton_touches');
  }
  const cols = common.join(', ');
  // INSERT OR IGNORE so a retried partial copy does not duplicate primary keys.
  db.exec(`INSERT OR IGNORE INTO flow_touches (${cols}) SELECT ${cols} FROM baton_touches`);
}

function legacyTouchesFullyCopied(db) {
  const missing = db.prepare(`
    SELECT COUNT(*) AS n FROM baton_touches b
    WHERE NOT EXISTS (SELECT 1 FROM flow_touches f WHERE f.id = b.id)
  `).get();
  return Number(missing.n) === 0;
}

function dropLegacyBatonTouches(db) {
  // Prefer a simple drop. Rebuild touch_events only when its FK still names baton_touches.
  const touchEventsSql = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'touch_events'")
    .get()?.sql || '';
  const refsLegacy = /REFERENCES\s+baton_touches/i.test(touchEventsSql);

  if (!refsLegacy) {
    db.exec('DROP TABLE baton_touches');
    return;
  }

  db.pragma('foreign_keys = OFF');
  try {
    db.exec('DROP TABLE baton_touches');
    db.exec(`
      CREATE TABLE touch_events_mig (
        id TEXT PRIMARY KEY,
        touch_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        actor TEXT DEFAULT 'human',
        payload TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY(touch_id) REFERENCES flow_touches(id)
      );
      INSERT INTO touch_events_mig (id, touch_id, event_type, actor, payload, created_at)
      SELECT id, touch_id, event_type, actor, payload, created_at FROM touch_events;
      DROP TABLE touch_events;
      ALTER TABLE touch_events_mig RENAME TO touch_events;
    `);
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

function moveLegacyBatonIntoFlow(db) {
  const touchEventsSql = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'touch_events'")
    .get()?.sql || '';
  const refsLegacy = /REFERENCES\s+baton_touches/i.test(touchEventsSql);

  if (!refsLegacy) {
    const tx = db.transaction(() => {
      copyLegacyTouchesIntoFlow(db);
      db.exec('DROP TABLE baton_touches');
    });
    tx();
    return;
  }

  // FK rebuild cannot live inside a SQLite transaction with foreign_keys toggles.
  copyLegacyTouchesIntoFlow(db);
  if (!legacyTouchesFullyCopied(db)) {
    throw new Error('Failed to copy all legacy baton_touches rows into flow_touches');
  }
  dropLegacyBatonTouches(db);
}

/**
 * Rename/move legacy Flow attention table baton_touches → flow_touches.
 *
 * Greenfield: schema.sql already created flow_touches (no baton_touches yet).
 * Upgrade: schema.sql may CREATE IF NOT EXISTS an empty flow_touches while
 * legacy data remains in baton_touches — copy rows then drop the legacy table.
 */
module.exports = function renameFlowTouches(db) {
  const hasFlow = tableExists(db, 'flow_touches');
  const hasBaton = tableExists(db, 'baton_touches');

  if (hasBaton && isLegacyFlowTouchShape(db, 'baton_touches')) {
    if (hasFlow) {
      if (rowCount(db, 'flow_touches') === 0) {
        moveLegacyBatonIntoFlow(db);
      } else if (isLegacyFlowTouchShape(db, 'flow_touches')) {
        if (rowCount(db, 'baton_touches') === 0) {
          dropLegacyBatonTouches(db);
        } else if (legacyTouchesFullyCopied(db)) {
          // Resume after an interrupted copy+drop.
          dropLegacyBatonTouches(db);
        } else {
          throw new Error(
            'Cannot migrate: both flow_touches and legacy baton_touches have Flow rows; manual merge required'
          );
        }
      } else {
        throw new Error(
          'Cannot migrate: both flow_touches and legacy baton_touches have data'
        );
      }
    } else {
      db.exec('ALTER TABLE baton_touches RENAME TO flow_touches');
    }
  } else if (!hasFlow && !hasBaton) {
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

  if (!tableExists(db, 'flow_touches')) {
    throw new Error('flow_touches missing after rename migration');
  }

  if (tableExists(db, 'baton_touches') && isLegacyFlowTouchShape(db, 'baton_touches')) {
    throw new Error('legacy baton_touches still present after rename migration');
  }

  const touchCols = columnNames(db, 'flow_touches');
  if (touchCols.has('status') && (touchCols.has('rank') || touchCols.has('created_at'))) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_flow_touches_status_rank
        ON flow_touches(status, ${touchCols.has('rank') ? 'rank' : 'created_at'}, created_at);
    `);
  }
  if (touchCols.has('task_id')) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_flow_touches_task_id
        ON flow_touches(task_id);
    `);
  }
  if (touchCols.has('review_packet_id')) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_flow_touches_review_packet_id
        ON flow_touches(review_packet_id);
    `);
  }
};
