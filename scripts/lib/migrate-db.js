'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'db', 'migrations');

function listMigrationFiles(migrationsDir) {
  return fs
    .readdirSync(migrationsDir)
    .filter((name) => /^\d{4}_.+\.(sql|js)$/.test(name))
    .sort()
    .map((name) => ({
      id: name.replace(/\.(sql|js)$/, ''),
      fileName: name,
      filePath: path.join(migrationsDir, name),
    }));
}

function checksumFile(filePath) {
  const body = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(body).digest('hex');
}

function ensureSchemaMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function appliedIds(db) {
  return new Set(
    db.prepare('SELECT id FROM schema_migrations ORDER BY id').all().map((row) => row.id)
  );
}

function runIntegrityChecks(db) {
  const integrity = db.pragma('integrity_check');
  const ok = Array.isArray(integrity)
    ? integrity.length === 1 && integrity[0].integrity_check === 'ok'
    : integrity === 'ok';
  if (!ok) {
    throw new Error(`PRAGMA integrity_check failed: ${JSON.stringify(integrity)}`);
  }
  const fkViolations = db.pragma('foreign_key_check');
  if (Array.isArray(fkViolations) && fkViolations.length > 0) {
    throw new Error(`PRAGMA foreign_key_check failed: ${JSON.stringify(fkViolations)}`);
  }
}

function backupDatabase(dbPath, backupDir) {
  if (!dbPath || dbPath === ':memory:' || dbPath.startsWith('file:')) return null;
  if (!fs.existsSync(dbPath)) return null;
  const dir = backupDir || path.join(path.dirname(dbPath), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(dir, `${path.basename(dbPath)}.${stamp}.bak`);
  fs.copyFileSync(dbPath, dest);
  return dest;
}

function applyOne(db, migration) {
  if (migration.fileName.endsWith('.js')) {
    const mod = require(migration.filePath);
    const run = typeof mod === 'function' ? mod : mod.up;
    if (typeof run !== 'function') {
      throw new Error(`Migration ${migration.fileName} must export a function or { up }`);
    }
    run(db);
    return;
  }
  const sql = fs.readFileSync(migration.filePath, 'utf8');
  db.exec(sql);
}

/**
 * Apply pending numbered migrations under db/migrations.
 * @param {import('better-sqlite3').Database} db
 * @param {{ migrationsDir?: string, backup?: boolean, backupDir?: string, dbPath?: string }} [options]
 */
function applyMigrations(db, options = {}) {
  const migrationsDir = options.migrationsDir || DEFAULT_MIGRATIONS_DIR;
  const files = listMigrationFiles(migrationsDir);

  if (options.backup) {
    backupDatabase(options.dbPath, options.backupDir);
  }

  db.pragma('foreign_keys = ON');
  ensureSchemaMigrations(db);
  const done = appliedIds(db);
  const applied = [];

  const tx = db.transaction(() => {
    for (const migration of files) {
      if (done.has(migration.id)) {
        const row = db.prepare('SELECT checksum FROM schema_migrations WHERE id = ?').get(migration.id);
        const current = checksumFile(migration.filePath);
        if (row && row.checksum !== current) {
          throw new Error(
            `Migration ${migration.id} checksum mismatch (db=${row.checksum}, file=${current})`
          );
        }
        continue;
      }
      applyOne(db, migration);
      const checksum = checksumFile(migration.filePath);
      db.prepare(
        'INSERT INTO schema_migrations (id, checksum, applied_at) VALUES (?, ?, datetime(\'now\'))'
      ).run(migration.id, checksum);
      applied.push(migration.id);
    }
  });

  tx();
  runIntegrityChecks(db);
  return { applied };
}

function tableNames(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => row.name);
}

module.exports = {
  DEFAULT_MIGRATIONS_DIR,
  applyMigrations,
  backupDatabase,
  ensureSchemaMigrations,
  listMigrationFiles,
  runIntegrityChecks,
  tableNames,
};
