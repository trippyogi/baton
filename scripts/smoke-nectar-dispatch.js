#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { MAX_BODY_BYTES, startNectarDispatchBridge } = require('./nectar-dispatch-bridge');

let baton = null;
let bridge = null;
let tempDir = null;
let batonOut = '';
let batonErr = '';
let BASE = '';

async function request(pathname, { method = 'GET', body, ok = true } = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) {}
  if (ok && !res.ok) throw new Error(`${method} ${pathname} -> ${res.status}: ${text}`);
  return { res, json, text };
}

async function waitFor(fn, label, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await fn();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  console.error('BATON stdout:\n' + batonOut);
  console.error('BATON stderr:\n' + batonErr);
  throw new Error(`Timed out waiting for ${label}`);
}

function randomPort(base) {
  return base + Math.floor(Math.random() * 300);
}

async function startBaton() {
  const port = String(randomPort(6700));
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baton-nectar-dispatch-'));
  BASE = `http://127.0.0.1:${port}`;
  bridge = await startNectarDispatchBridge({
    port: randomPort(4600),
    token: 'test',
    inboxDir: path.join(tempDir, 'nectar-inbox'),
  });
  baton = spawn(process.execPath, ['server/index.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      VMC_PORT: port,
      BATON_PUBLIC_BASE_URL: BASE,
      BATON_DB_PATH: path.join(tempDir, 'dispatch.db'),
      REDIS_URL: 'redis://127.0.0.1:0',
      NECTAR_WEBHOOK_URL: bridge.url,
      NECTAR_DISPATCH_TOKEN: 'test',
      BATON_CALLBACK_TOKEN: 'callback-token',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  baton.stdout.on('data', data => { batonOut += data.toString(); if (process.env.BATON_SMOKE_VERBOSE) process.stdout.write(data); });
  baton.stderr.on('data', data => { batonErr += data.toString(); if (process.env.BATON_SMOKE_VERBOSE) process.stderr.write(data); });
  await waitFor(async () => {
    try { return (await request('/api/health', { ok: false })).res.ok; }
    catch (_) { return false; }
  }, 'BATON health');
}

async function main() {
  const help = spawnSync(process.execPath, ['scripts/nectar-dispatch-bridge.js', '--help'], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
  });
  assert.equal(help.status, 0, 'Nectar bridge --help exits cleanly');
  assert.ok(help.stdout.includes('POST /baton/dispatch'), 'Nectar bridge help documents dispatch route');
  assert.ok(help.stdout.includes('NECTAR_BRIDGE_MAX_BODY_BYTES'), 'Nectar bridge help documents body limit env');

  await startBaton();

  const wrongContentType = await fetch(bridge.url, {
    method: 'POST',
    headers: { Authorization: 'Bearer test', 'Content-Type': 'text/plain' },
    body: JSON.stringify({ schema: 'baton.dispatch.v1' }),
  });
  const wrongContentTypeJson = await wrongContentType.json();
  assert.equal(wrongContentType.status, 415, 'Nectar bridge rejects non-JSON content types');
  assert.deepEqual(wrongContentTypeJson.errors, ['content-type must be application/json'], 'non-JSON content type has explicit rejection reason');

  const malformed = await fetch(bridge.url, {
    method: 'POST',
    headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    body: '{not-json',
  });
  const malformedJson = await malformed.json();
  assert.equal(malformed.status, 400, 'Nectar bridge rejects malformed JSON');
  assert.deepEqual(malformedJson.errors, ['invalid json'], 'malformed JSON has explicit rejection reason');


  const nonObject = await fetch(bridge.url, {
    method: 'POST',
    headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    body: 'null',
  });
  const nonObjectJson = await nonObject.json();
  assert.equal(nonObject.status, 400, 'Nectar bridge rejects non-object JSON bodies');
  assert.deepEqual(nonObjectJson.errors, ['body must be a JSON object'], 'non-object JSON has explicit rejection reason');

  const oversized = await fetch(bridge.url, {
    method: 'POST',
    headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ schema: 'baton.dispatch.v1', padding: 'x'.repeat(MAX_BODY_BYTES + 1) }),
  });
  const oversizedJson = await oversized.json();
  assert.equal(oversized.status, 413, 'Nectar bridge rejects oversized bodies');
  assert.deepEqual(oversizedJson.errors, ['body too large'], 'oversized body has explicit rejection reason');

  const badCallback = await fetch(bridge.url, {
    method: 'POST',
    headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      schema: 'baton.dispatch.v1',
      dispatch_id: 'disp_bad_callback',
      run_id: 'run_bad_callback',
      task_id: 'task_bad_callback',
      touch_id: 'touch_bad_callback',
      agent_id: 'nectar',
      callbacks: { ack_url: 'not-a-url' },
    }),
  });
  const badCallbackJson = await badCallback.json();
  assert.equal(badCallback.status, 400, 'Nectar bridge rejects malformed callback URLs');
  assert.ok(badCallbackJson.errors.includes('ack_url must be a valid URL'), 'malformed callback URL has explicit rejection reason');

  const credentialCallback = await fetch(bridge.url, {
    method: 'POST',
    headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      schema: 'baton.dispatch.v1',
      dispatch_id: 'disp_credential_callback',
      run_id: 'run_credential_callback',
      task_id: 'task_credential_callback',
      touch_id: 'touch_credential_callback',
      agent_id: 'nectar',
      callbacks: { ack_url: 'https://user:pass@example.invalid/callback' },
    }),
  });
  const credentialCallbackJson = await credentialCallback.json();
  assert.equal(credentialCallback.status, 400, 'Nectar bridge rejects callback URLs with embedded credentials');
  assert.ok(credentialCallbackJson.errors.includes('ack_url must not include credentials'), 'credential callback URL has explicit rejection reason');

  const initialHealth = await fetch(`${bridge.url.replace('/baton/dispatch', '')}/health`);
  const initialHealthJson = await initialHealth.json();
  const initialHealthHead = await fetch(`${bridge.url.replace('/baton/dispatch', '')}/health`, { method: 'HEAD' });
  assert.equal(initialHealthHead.status, 200, 'Nectar bridge supports HEAD health probes');
  assert.equal(initialHealthJson.bind_host, '127.0.0.1', 'Nectar bridge health exposes bind host');
  assert.equal(initialHealthJson.health_schema_version, 'baton.nectar_bridge.health.v1', 'Nectar bridge health exposes stable health schema');
  assert.equal(initialHealthJson.bridge_version, '0.1.0', 'Nectar bridge health exposes package version');
  assert.equal(initialHealthJson.dispatch_path, '/baton/dispatch', 'Nectar bridge health exposes dispatch path');
  assert.equal(initialHealthJson.token_required, true, 'Nectar bridge health exposes whether auth is required');
  assert.match(initialHealthJson.started_at, /^\d{4}-\d{2}-\d{2}T/, 'Nectar bridge health exposes start timestamp');
  assert.equal(typeof initialHealthJson.uptime_seconds, 'number', 'Nectar bridge health exposes uptime seconds');
  assert.ok(initialHealthJson.uptime_seconds >= 0, 'Nectar bridge uptime is non-negative');
  assert.equal(initialHealthJson.received_count, 0, 'Nectar bridge health exposes received count before dispatch');
  assert.equal(initialHealthJson.rejected_count, 6, 'Nectar bridge health exposes rejection count before dispatch');
  assert.equal(initialHealthJson.inbox_record_count, 0, 'Nectar bridge health exposes inbox record count before dispatch');
  assert.match(initialHealthJson.inbox_dir, /nectar-inbox$/, 'Nectar bridge health exposes configured inbox directory');
  assert.equal(initialHealthJson.inbox_writable, true, 'Nectar bridge health exposes writable inbox state');
  assert.equal(initialHealthJson.last_received_at, null, 'Nectar bridge health has no last received timestamp before dispatch');
  assert.equal(initialHealthJson.last_received_dispatch_id, null, 'Nectar bridge health has no last dispatch id before dispatch');
  assert.equal(initialHealthJson.last_received_run_id, null, 'Nectar bridge health has no last run id before dispatch');
  assert.equal(initialHealthJson.last_inbox_path, null, 'Nectar bridge health has no last inbox path before dispatch');
  assert.match(initialHealthJson.last_rejected_at, /^\d{4}-\d{2}-\d{2}T/, 'Nectar bridge health exposes last rejection timestamp');
  assert.equal(initialHealthJson.last_rejection_status, 400, 'Nectar bridge health exposes last rejection status');
  assert.ok(initialHealthJson.last_rejection_reason.includes('ack_url must not include credentials'), 'Nectar bridge health exposes last rejection reason');
  assert.deepEqual(initialHealthJson.last_rejection_errors, ['ack_url must not include credentials'], 'Nectar bridge health exposes structured last rejection errors');
  assert.equal(initialHealthJson.max_body_bytes, MAX_BODY_BYTES, 'Nectar bridge health exposes max body bytes');

  const nectar = (await request('/api/agents', {
    method: 'POST',
    body: {
      id: 'nectar',
      name: 'Nectar',
      type: 'personal-ai-agent',
      skills: ['planning', 'research', 'coding', 'memory'],
      dispatch_enabled: true,
      dispatch_transport: 'webhook',
      dispatch_target: 'NECTAR_WEBHOOK_URL',
      dispatch_config: { url_env: 'NECTAR_WEBHOOK_URL', token_env: 'NECTAR_DISPATCH_TOKEN', timeout_ms: 3000 },
    },
  })).json;
  assert.equal(nectar.dispatch_enabled, true, 'Nectar dispatch enabled');

  const task = (await request('/api/tasks', {
    method: 'POST',
    body: {
      title: 'Smoke dispatch to Nectar bridge',
      description: 'Verify BATON can hand a task envelope to the local Nectar bridge.',
      status: 'ready',
      priority: 'high',
      owner: 'nectar',
    },
  })).json;

  const prep = (await request(`/api/tasks/${task.id}/dispatch/prepare`, {
    method: 'POST',
    body: { agent_id: 'nectar', instructions: 'Smoke-test the local Nectar bridge.' },
  })).json;
  assert.equal(prep.run.agent_id, 'nectar', 'prepared run targets Nectar');
  assert.equal(prep.envelope.agent_id, 'nectar', 'prepared envelope targets Nectar');

  const live = (await request('/api/dispatch/test', {
    method: 'POST',
    body: { dry_run: false, agent_id: 'nectar', task_id: task.id, touch_id: prep.run.touch_id, intent: 'orchestrate' },
  })).json;
  assert.equal(live.dispatch_status, 'accepted', 'Nectar bridge accepted live dispatch');
  assert.equal(bridge.received.length, 1, 'Nectar bridge received one envelope');

  const finalHealth = await fetch(`${bridge.url.replace('/baton/dispatch', '')}/health`);
  const finalHealthJson = await finalHealth.json();
  assert.equal(finalHealthJson.received_count, 1, 'Nectar bridge health updates received count after dispatch');
  assert.equal(finalHealthJson.rejected_count, 6, 'Nectar bridge health preserves rejection count after dispatch');
  assert.equal(finalHealthJson.inbox_record_count, 1, 'Nectar bridge health updates inbox record count after dispatch');
  assert.equal(finalHealthJson.inbox_writable, true, 'Nectar bridge inbox remains writable after dispatch');
  assert.match(finalHealthJson.last_received_at, /^\d{4}-\d{2}-\d{2}T/, 'Nectar bridge health exposes last received timestamp');
  assert.equal(finalHealthJson.last_received_dispatch_id, bridge.received[0].envelope.dispatch_id, 'Nectar bridge health exposes last dispatch id');
  assert.equal(finalHealthJson.last_received_run_id, bridge.received[0].envelope.run_id, 'Nectar bridge health exposes last run id');
  assert.match(finalHealthJson.last_inbox_path, /^local\/nectar-dispatch-inbox|^\.\.\//, 'Nectar bridge health exposes last inbox path');

  const files = fs.readdirSync(bridge.inboxDir).filter(file => file.endsWith('.json'));
  assert.equal(files.length, 1, 'Nectar bridge wrote one inbox record');
  const record = JSON.parse(fs.readFileSync(path.join(bridge.inboxDir, files[0]), 'utf8'));
  assert.equal(record.envelope.agent_id, 'nectar', 'inbox record stores Nectar envelope');
  assert.ok(record.prompt.includes('BATON dispatch received for Nectar'), 'inbox record includes OpenClaw-ready prompt');
  assert.ok(record.prompt.includes(`Dispatch: ${record.envelope.dispatch_id}`), 'prompt includes dispatch id for traceability');
  assert.ok(record.prompt.includes(`Touch: ${record.envelope.touch_id}`), 'prompt includes touch id for traceability');
  assert.ok(record.prompt.includes(`- ack_url: ${record.envelope.callbacks.ack_url}`), 'prompt includes ack callback');
  assert.ok(record.prompt.includes(`- status_url: ${record.envelope.callbacks.status_url}`), 'prompt includes status callback');
  assert.ok(record.prompt.includes(`- review_packet_url: ${record.envelope.callbacks.review_packet_url}`), 'prompt includes review packet callback');
  assert.ok(record.prompt.includes('Local safety:'), 'prompt includes local safety section');
  assert.ok(record.prompt.includes('do not publish the envelope'), 'prompt warns against exposing private handoff context');

  console.log(`smoke-nectar-dispatch ok against ${BASE}`);
}

async function cleanup() {
  const waits = [];
  if (baton) {
    baton.kill('SIGTERM');
    waits.push(new Promise(resolve => baton.once('exit', resolve)));
  }
  if (bridge?.server) waits.push(new Promise(resolve => bridge.server.close(resolve)));
  await Promise.race([Promise.all(waits), new Promise(resolve => setTimeout(resolve, 1000))]);
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
}).finally(cleanup);
