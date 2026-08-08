'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { applyMigrations, tableNames } = require('./migrate-db');

const ROOT = path.join(__dirname, '..', '..');
const FIXTURE = path.join(ROOT, 'db', 'fixtures', 'legacy-pre-phase3.sql');

function withTempDb(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baton-migrate-'));
  const dbPath = path.join(dir, 'test.db');
  // Intentionally leave temp dirs; deleting open WAL-backed DBs aborts better-sqlite3 on Windows.
  return run(dbPath, dir);
}

function legacy() {
  withTempDb((dbPath) => {
    const db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    db.exec(fs.readFileSync(FIXTURE, 'utf8'));
    const before = Number(db.prepare('SELECT COUNT(*) AS n FROM baton_touches').get().n);
    assert.equal(before, 1);

    const result = applyMigrations(db, { dbPath, backup: false });
    assert.ok(result.applied.includes('0002_rename_flow_touches'));
    assert.ok(result.applied.includes('0004_canonical_domain_tables'));
    assert.ok(result.applied.includes('0005_baton_touches'));
    assert.ok(result.applied.includes('0007_migrate_flow_touches_to_baton'));

    const names = tableNames(db);
    assert.ok(names.includes('flow_touches'));
    assert.ok(names.includes('baton_touches'));
    assert.ok(names.includes('decision_requests'));
    assert.ok(names.includes('dispatches'));
    assert.ok(names.includes('task_blockers'));

    assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM flow_touches').get().n), 1);
    assert.equal(db.prepare('SELECT id FROM flow_touches').get().id, 'touch-legacy-1');
    assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM baton_touches').get().n), 0);

    const taskCols = db.prepare('PRAGMA table_info(tasks)').all().map((c) => c.name);
    assert.ok(taskCols.includes('version'));
    assert.ok(taskCols.includes('objective'));
    assert.ok(taskCols.includes('archived_at'));

    const touchCols = db.prepare('PRAGMA table_info(baton_touches)').all().map((c) => c.name);
    assert.ok(touchCols.includes('dedupe_key'));
    assert.ok(touchCols.includes('kind'));
    assert.ok(touchCols.includes('source_type'));
  });
}

function greenfield() {
  withTempDb((dbPath) => {
    const db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    db.exec(fs.readFileSync(path.join(ROOT, 'server', 'schema.sql'), 'utf8'));

    const result = applyMigrations(db, { dbPath, backup: false });
    assert.ok(result.applied.includes('0005_baton_touches'));

    const names = tableNames(db);
    assert.ok(names.includes('flow_touches'));
    assert.ok(names.includes('baton_touches'));
    assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM baton_touches').get().n), 0);

    db.prepare(`
      INSERT INTO baton_touches (
        id, kind, source_type, source_id, source_version, status,
        opened_at, source_event_id, dedupe_key, created_at, updated_at
      ) VALUES (
        't1', 'review_required', 'review_packet', 'rp1', 1, 'open',
        datetime('now'), 'evt1', 'review_packet:rp1:v1', datetime('now'), datetime('now')
      )
    `).run();
    assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM baton_touches').get().n), 1);
  });
}

function upgrade() {
  withTempDb((dbPath) => {
    const db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    db.exec(fs.readFileSync(FIXTURE, 'utf8'));
    assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM baton_touches').get().n), 1);

    db.exec(`
      CREATE TABLE IF NOT EXISTS flow_touches (
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
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `);
    assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM flow_touches').get().n), 0);
    assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM baton_touches').get().n), 1);

    applyMigrations(db, { dbPath, backup: false });

    assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM flow_touches').get().n), 1);
    assert.equal(db.prepare('SELECT id FROM flow_touches').get().id, 'touch-legacy-1');
    assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM baton_touches').get().n), 0);
    const cols = db.prepare('PRAGMA table_info(baton_touches)').all().map((c) => c.name);
    assert.ok(cols.includes('dedupe_key'));
  });
}

function indexes() {
  withTempDb((dbPath) => {
    const db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    db.exec(fs.readFileSync(path.join(ROOT, 'server', 'schema.sql'), 'utf8'));
    applyMigrations(db, { dbPath, backup: false });

    db.prepare(
      `INSERT INTO tasks (id, title, status, version, objective, acceptance_criteria_json, why_now_json, legacy_payload_json)
       VALUES ('t-dup', 'Dup', 'in_progress', 1, 'o', '[]', '{}', '{}')`
    ).run();
    const idx = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_runs_one_nonterminal_per_task'`
      )
      .get();
    assert.ok(idx, 'unique non-terminal run index exists');
    const linear = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_runs_linear_parent'`)
      .get();
    assert.ok(linear, 'linear parent unique index exists');

    db.prepare(
      `INSERT INTO runs (id, task_id, status, attempt_number, kind, input_snapshot_json, policy_json, version, created_at, updated_at)
       VALUES ('r-a', 't-dup', 'running', 1, 'execute', '{}', '{}', 1, datetime('now'), datetime('now'))`
    ).run();
    assert.throws(() => {
      db.prepare(
        `INSERT INTO runs (id, task_id, status, attempt_number, kind, input_snapshot_json, policy_json, version, created_at, updated_at)
         VALUES ('r-b', 't-dup', 'pending_dispatch', 1, 'execute', '{}', '{}', 1, datetime('now'), datetime('now'))`
      ).run();
    });
  });
}

function flow() {
  withTempDb((dbPath) => {
    const db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    db.exec(fs.readFileSync(path.join(ROOT, 'server', 'schema.sql'), 'utf8'));
    applyMigrations(db, { dbPath, backup: false });

    db.prepare(
      `INSERT INTO tasks (id, title, status, version, objective, acceptance_criteria_json, why_now_json, legacy_payload_json)
       VALUES ('t-mig', 'Migrate me', 'ready', 1, 'o', '[]', '{}', '{}')`
    ).run();
    db.prepare(
      `INSERT INTO decision_requests (id, task_id, question, status, version, created_at, updated_at)
       VALUES ('dec-mig', 't-mig', 'Ship?', 'open', 1, datetime('now'), datetime('now'))`
    ).run();
    db.prepare(
      `INSERT INTO flow_touches (
         id, task_id, title, type, status, primary_action, score, source, created_at, updated_at
       ) VALUES (
         'flow-1', 't-mig', 'Decide', 'decide', 'pending', 'answer', 12, 'generated', datetime('now'), datetime('now')
       )`
    ).run();
    db.prepare(
      `INSERT INTO flow_touches (
         id, task_id, title, type, status, primary_action, score, source, created_at, updated_at
       ) VALUES (
         'flow-2', 't-mig', 'Refine', 'refine', 'pending', 'refine', 5, 'generated', datetime('now'), datetime('now')
       )`
    ).run();

    db.prepare("DELETE FROM schema_migrations WHERE id = '0007_migrate_flow_touches_to_baton'").run();
    const again = applyMigrations(db, { dbPath, backup: false });
    assert.ok(again.applied.includes('0007_migrate_flow_touches_to_baton'));

    const baton = db.prepare('SELECT * FROM baton_touches').all();
    assert.ok(baton.some((r) => r.kind === 'decision_required'));
    assert.ok(!baton.some((r) => r.kind === 'refine'));
  });
}

module.exports = {
  legacy,
  greenfield,
  upgrade,
  indexes,
  flow,
};
