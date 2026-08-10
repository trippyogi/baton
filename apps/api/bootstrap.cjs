'use strict';

/**
 * Stable CommonJS entry for Node 24 + better-sqlite3.
 * Zod validation lives in @baton/contracts (unit-tested); the full TS
 * server entry will adopt it during the route port. Keep this file free of
 * ESM/Zod requires so the native SQLite addon does not crash on Windows.
 *
 * Windows + better-sqlite3: ephemeral Statement finalizers can abort Node if
 * GC runs while the large server module graph is loading. Prefer launching
 * with `node --expose-gc` (npm start / smoke do this) so we can drain those
 * finalizers after DB bootstrap and before createApp.
 */
const path = require('path');
const dotenv = require('dotenv');

function loadRuntimeConfig(env = process.env) {
  const rawPort = env.VMC_PORT || env.PORT || '4200';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid port value: ${rawPort}`);
  }
  const host = String(env.BATON_HOST || env.HOST || '127.0.0.1').trim() || '127.0.0.1';
  return {
    port,
    host,
    apiToken: env.BATON_API_TOKEN ? String(env.BATON_API_TOKEN).trim() : null,
  };
}

function drainSqliteFinalizers() {
  if (typeof global.gc === 'function') {
    global.gc();
    global.gc();
  }
}

function main() {
  const rootDir = path.resolve(__dirname, '../..');
  dotenv.config({ path: path.join(rootDir, '.env') });

  const config = loadRuntimeConfig(process.env);
  process.env.VMC_PORT = String(config.port);
  process.env.BATON_HOST = config.host;
  if (config.apiToken) process.env.BATON_API_TOKEN = config.apiToken;
  else delete process.env.BATON_API_TOKEN;

  // On Windows, re-exec under --expose-gc when missing so Statement teardown is safe.
  if (
    process.platform === 'win32' &&
    typeof global.gc !== 'function' &&
    process.env.BATON_GC_WRAP !== '1'
  ) {
    const { spawn } = require('child_process');
    const child = spawn(
      process.execPath,
      ['--expose-gc', __filename, ...process.argv.slice(2)],
      {
        stdio: 'inherit',
        env: { ...process.env, BATON_GC_WRAP: '1' },
      }
    );
    child.on('exit', (code, signal) => {
      if (signal) process.exit(1);
      process.exit(code == null ? 1 : code);
    });
    return;
  }

  require('express');
  require('../../server/db');
  drainSqliteFinalizers();

  const start = () => {
    try {
      drainSqliteFinalizers();
      const { startServer } = require('../../server/index.js');
      startServer({ port: config.port, host: config.host });
    } catch (err) {
      console.error('[baton] failed to start:', err);
      process.exit(1);
    }
  };

  if (process.platform === 'win32') {
    setImmediate(start);
  } else {
    start();
  }
}

try {
  main();
} catch (err) {
  console.error('[baton] failed to start:', err);
  process.exit(1);
}
