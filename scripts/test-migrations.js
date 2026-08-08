#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { applyMigrations, tableNames } = require('./lib/migrate-db');

const ROOT = path.join(__dirname, '..');
const FIXTURE = path.join(ROOT, 'db', 'fixtures', 'legacy-pre-phase3.sql');

function withTempDb(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baton-migrate-'));
  const dbPath = path.join(dir, 'test.db');
  try {
    return run(dbPath, dir);
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) {
      /* ignore */
    }
  }
}

function testLegacyFixtureMigration() {
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

    const names = tableNames(db);
    assert.ok(names.includes('flow_touches'));
    assert.ok(names.includes('baton_touches'));
    assert.ok(names.includes('decision_requests'));
    assert.ok(names.includes('dispatches'));
    assert.ok(names.includes('task_blockers'));

    // Legacy row preserved under flow_touches; canonical projection empty.
    assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM flow_touches').get().n), 1);
    assert.equal(
      db.prepare('SELECT id FROM flow_touches').get().id,
      'touch-legacy-1'
    );
    assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM baton_touches').get().n), 0);

    // Canonical columns present on evolved tables.
    const taskCols = db.prepare('PRAGMA table_info(tasks)').all().map((c) => c.name);
    assert.ok(taskCols.includes('version'));
    assert.ok(taskCols.includes('objective'));
    assert.ok(taskCols.includes('archived_at'));

    const touchCols = db.prepare('PRAGMA table_info(baton_touches)').all().map((c) => c.name);
    assert.ok(touchCols.includes('dedupe_key'));
    assert.ok(touchCols.includes('kind'));
    assert.ok(touchCols.includes('source_type'));

    // Idempotent second apply.
    const again = applyMigrations(db, { dbPath, backup: false });
    assert.deepEqual(again.applied, []);

    db.close();
  });
}

function testGreenfieldSchemaThenMigrate() {
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

    // Insert into canonical baton_touches proves shape.
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

    db.close();
  });
}

function main() {
  testLegacyFixtureMigration();
  testGreenfieldSchemaThenMigrate();
  console.log('migration tests passed');
}

main();
