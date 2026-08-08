'use strict';

/**
 * Stable CommonJS entry for Node 24 + better-sqlite3.
 * Zod validation lives in @baton/contracts (unit-tested); the full TS
 * server entry will adopt it during the route port. Keep this file free of
 * ESM/Zod requires so the native SQLite addon does not crash on Windows.
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

function main() {
  const rootDir = path.resolve(__dirname, '../..');
  dotenv.config({ path: path.join(rootDir, '.env') });

  const config = loadRuntimeConfig(process.env);
  process.env.VMC_PORT = String(config.port);
  process.env.BATON_HOST = config.host;
  if (config.apiToken) process.env.BATON_API_TOKEN = config.apiToken;
  else delete process.env.BATON_API_TOKEN;

  const { startServer } = require('../../server/index.js');
  startServer({ port: config.port, host: config.host });
}

try {
  main();
} catch (err) {
  console.error('[baton] failed to start:', err);
  process.exit(1);
}
