#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { applyMigrations, listMigrationFiles, DEFAULT_MIGRATIONS_DIR } = require('./lib/migrate-db');

function parseArgs(argv) {
  const args = {
    dbPath: process.env.BATON_DB_PATH || path.join(__dirname, '..', 'data', 'vmc.db'),
    backup: true,
    status: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--no-backup') args.backup = false;
    else if (a === '--status') args.status = true;
    else if (a === '--db' && argv[i + 1]) {
      args.dbPath = argv[++i];
    } else if (a === '--help' || a === '-h') {
      args.help = true;
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: node scripts/migrate.js [--db path] [--no-backup] [--status]

Applies numbered SQL/JS migrations under db/migrations.
Default DB: BATON_DB_PATH or data/vmc.db
`);
    process.exit(0);
  }

  fs.mkdirSync(path.dirname(args.dbPath), { recursive: true });
  const db = new Database(args.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  try {
    if (args.status) {
      const files = listMigrationFiles(DEFAULT_MIGRATIONS_DIR);
      db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          id TEXT PRIMARY KEY,
          checksum TEXT NOT NULL,
          applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      const done = new Set(
        db.prepare('SELECT id FROM schema_migrations').all().map((r) => r.id)
      );
      for (const f of files) {
        console.log(`${done.has(f.id) ? 'applied' : 'pending'}  ${f.id}`);
      }
      return;
    }

    const result = applyMigrations(db, {
      dbPath: args.dbPath,
      backup: args.backup,
    });
    if (result.applied.length === 0) {
      console.log('Migrations up to date.');
    } else {
      console.log(`Applied: ${result.applied.join(', ')}`);
    }
  } finally {
    db.close();
  }
}

main();
