#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const dbPath = path.resolve(process.env.BATON_DB_PATH || path.join(__dirname, '..', 'data', 'vmc.db'));
const targets = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.question(`Reset BATON local database at ${dbPath}? This deletes SQLite data. [y/N] `, answer => {
  rl.close();
  if (!/^y(es)?$/i.test(answer.trim())) {
    console.log('Reset cancelled. No files deleted.');
    return;
  }

  const deleted = [];
  const missing = [];

  for (const target of targets) {
    if (!fs.existsSync(target)) {
      missing.push(target);
      continue;
    }
    fs.rmSync(target, { force: true });
    deleted.push(target);
  }

  console.log('BATON local database reset complete.');
  console.log(`Deleted ${deleted.length} file(s):`);
  for (const target of deleted) console.log(`- ${target}`);
  if (missing.length) {
    console.log(`Skipped ${missing.length} missing file(s):`);
    for (const target of missing) console.log(`- ${target}`);
  }
});
