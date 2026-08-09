#!/usr/bin/env node
'use strict';

/**
 * Migration suite runner.
 * Parent process never loads better-sqlite3 (Windows native teardown aborts).
 * Each case runs in a child and writes a sentinel on success.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CASE_NAMES = ['legacy', 'greenfield', 'upgrade', 'indexes', 'flow'];

function main() {
  const caseName = process.argv[2];
  const sentinelPath = process.argv[3];

  if (caseName) {
    const cases = require('./lib/migration-test-cases');
    const fn = cases[caseName];
    if (!fn) {
      console.error(`Unknown migration test case: ${caseName}`);
      process.exit(1);
    }
    fn();
    if (sentinelPath) fs.writeFileSync(sentinelPath, 'ok\n');
    process.exit(0);
  }

  for (const name of CASE_NAMES) {
    const sentinel = path.join(os.tmpdir(), `baton-mig-${name}.ok`);
    let passed = false;
    let result = null;
    const attempts = process.platform === 'win32' ? 5 : 1;
    for (let attempt = 1; attempt <= attempts && !passed; attempt += 1) {
      try {
        fs.unlinkSync(sentinel);
      } catch (_) {
        /* ignore */
      }
      result = spawnSync(process.execPath, [__filename, name, sentinel], {
        stdio: 'inherit',
        env: process.env,
      });
      passed = fs.existsSync(sentinel);
      if (!passed && process.platform === 'win32') {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500 * attempt);
      }
    }
    try {
      fs.unlinkSync(sentinel);
    } catch (_) {
      /* ignore */
    }
    if (!passed) {
      console.error(`migration case failed: ${name} (status=${result && result.status})`);
      process.exit(result && result.status != null && result.status !== 0 ? result.status : 1);
    }
    console.log(`migration case ok: ${name}`);
  }
  console.log('migration tests passed');
  process.exit(0);
}

main();
