#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const checks = [];

function check(name, fn) {
  try {
    const detail = fn();
    checks.push({ name, ok: true, detail });
  } catch (err) {
    checks.push({ name, ok: false, detail: err.message });
  }
}

function exists(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) throw new Error(`${rel} missing`);
  return rel;
}

check('Node runtime', () => {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 20) {
    throw new Error(`expected Node 20+; found ${process.version}. Run: nvm install 22 && nvm use`);
  }
  if (major > 24) return `${process.version} (BATON is tested on Node 20/22 and supports engines >=20 <25)`;
  return `${process.version} (BATON is tested on Node 20/22)`;
});

check('npm lockfile', () => exists('package-lock.json'));
check('README', () => exists('README.md'));
check('demo guide', () => exists('docs/guides/demo.md'));
check('fork quickstart', () => exists('docs/guides/fork-quickstart.md'));
check('Flow screenshot', () => exists('docs/images/flow-screen.png'));
check('env example', () => exists('.env.example'));

check('ignored local data dirs writable', () => {
  for (const rel of ['data', 'local', 'exports']) {
    const dir = path.join(ROOT, rel);
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.doctor-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe);
  }
  return 'data/, local/, exports/ writable';
});

check('SQLite native module loads', () => {
  require('better-sqlite3');
  return 'better-sqlite3 ok';
});

check('private audit script available', () => exists('scripts/audit-private-data.js'));
check('demo seed script available', () => exists('scripts/seed-demo.js'));

check('git ignore protects local state', () => {
  const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  for (const needle of ['data/*.db', '.env', 'local/', 'baton-private/', 'exports/redacted-*.json']) {
    if (!ignore.includes(needle)) throw new Error(`${needle} not in .gitignore`);
  }
  return 'private/local patterns ignored';
});

const failed = checks.filter(c => !c.ok);
for (const c of checks) {
  console.log(`${c.ok ? 'ok' : 'FAIL'} - ${c.name}${c.detail ? `: ${c.detail}` : ''}`);
}

if (failed.length) {
  console.error(`\nBATON doctor failed: ${failed.length} check(s) need attention.`);
  process.exit(1);
}

console.log('\nBATON doctor passed. Next: npm run demo && npm start');
