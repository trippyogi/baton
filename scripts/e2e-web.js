#!/usr/bin/env node
'use strict';

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const webDir = path.join(root, 'apps', 'web');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baton-e2e-'));

let port = null;
let dbPath = null;
let baseUrl = null;
let child = null;
let childOut = '';
let childErr = '';

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd || root,
    env: { ...process.env, ...(opts.env || {}) },
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed with ${result.status}`);
  }
}

async function waitForHealth(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (child && child.exitCode != null) {
      throw new Error(`smoke server exited early with code ${child.exitCode}\n${childOut}\n${childErr}`);
    }
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${baseUrl}/api/health\n${childOut}\n${childErr}`);
}

function startServer(attempt) {
  port = String(4700 + Math.floor(Math.random() * 200) + attempt);
  dbPath = path.join(tempDir, `e2e-${attempt}.db`);
  baseUrl = `http://127.0.0.1:${port}`;
  childOut = '';
  childErr = '';
  child = spawn(process.execPath, ['apps/api/bootstrap.cjs'], {
    cwd: root,
    env: {
      ...process.env,
      VMC_PORT: port,
      BATON_DB_PATH: dbPath,
      REDIS_URL: 'redis://127.0.0.1:0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => { childOut += d.toString(); });
  child.stderr.on('data', (d) => { childErr += d.toString(); });
}

async function main() {
  run('npm', ['run', 'build', '-w', '@baton/web']);

  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      startServer(attempt);
      await waitForHealth();
      lastError = null;
      break;
    } catch (err) {
      lastError = err;
      try { child?.kill('SIGKILL'); } catch (_) {}
      child = null;
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
  if (lastError) throw lastError;

  run('npx', ['playwright', 'test', '-c', 'playwright.config.ts'], {
    cwd: webDir,
    env: { BATON_BASE_URL: baseUrl },
  });
}

async function cleanup() {
  if (child) {
    child.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (child.exitCode == null) child.kill('SIGKILL');
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
}

main()
  .then(async () => {
    await cleanup();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err);
    await cleanup();
    process.exit(1);
  });
