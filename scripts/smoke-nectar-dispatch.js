#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { MAX_BODY_BYTES, bridgeConfigFromEnv, inboxRecordProcessingStatusCounts, isLoopbackHost, pendingInboxAttentionLevel, pendingInboxAttentionReason, pendingInboxRecordNames, readNextInboxRecord, startNectarDispatchBridge } = require('./nectar-dispatch-bridge');

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
  assert.ok(help.stdout.includes('non-loopback binds require NECTAR_DISPATCH_TOKEN'), 'Nectar bridge help documents non-loopback auth guard');
  assert.ok(help.stdout.includes('--check-env'), 'Nectar bridge help documents config check mode');
  assert.ok(help.stdout.includes('--prompt-only'), 'Nectar bridge help documents prompt-only next-inbox mode');
  assert.ok(help.stdout.includes('--path-only'), 'Nectar bridge help documents path-only next-inbox mode');
  const checkEnvInbox = fs.mkdtempSync(path.join(os.tmpdir(), 'baton-nectar-check-env-'));
  fs.writeFileSync(path.join(checkEnvInbox, 'pending-check.json'), JSON.stringify({ processing_status: 'pending_local_operator', received_at: new Date().toISOString() }));
  const checkEnv = spawnSync(process.execPath, ['scripts/nectar-dispatch-bridge.js', '--check-env'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, NECTAR_DISPATCH_INBOX: checkEnvInbox, NECTAR_BRIDGE_PORT: String(randomPort(4800)) },
    encoding: 'utf8',
  });
  assert.equal(checkEnv.status, 0, 'Nectar bridge --check-env exits cleanly for local config');
  const checkEnvJson = JSON.parse(checkEnv.stdout);
  assert.equal(checkEnvJson.schema_version, 'baton.nectar_bridge.check_env.v1', 'check-env exposes stable schema');
  assert.equal(checkEnvJson.ok, true, 'check-env reports ok for local config');
  assert.equal(checkEnvJson.check_env_status, 'pending_local_operator', 'check-env status highlights pending local handoffs');
  assert.equal(checkEnvJson.inbox_creatable, false, 'existing temp inbox does not need creation');
  assert.equal(checkEnvJson.inbox_record_count, 1, 'check-env reports existing inbox records without starting bridge');
  assert.equal(checkEnvJson.pending_inbox_count, 1, 'check-env reports pending local operator records');
  assert.deepEqual(checkEnvJson.inbox_processing_status_counts, { pending_local_operator: 1 }, 'check-env reports inbox processing status counts');
  assert.match(checkEnvJson.pending_inbox_next_received_at, /^\d{4}-\d{2}-\d{2}T/, 'check-env reports the next pending inbox timestamp');
  assert.equal(typeof checkEnvJson.pending_inbox_next_age_seconds, 'number', 'check-env aliases next pending inbox age seconds');
  assert.equal(typeof checkEnvJson.pending_inbox_next_age_minutes, 'number', 'check-env aliases next pending inbox age minutes');
  assert.equal(checkEnvJson.pending_inbox_next_age_bucket, checkEnvJson.pending_inbox_oldest_age_bucket, 'check-env aliases next pending inbox age bucket');
  assert.equal(checkEnvJson.pending_inbox_attention_reason, 'pending_inbox_waiting', 'check-env reports why pending inbox needs attention');
  assert.equal(checkEnvJson.pending_inbox_attention_level, 'low', 'check-env reports machine-readable pending inbox attention level');
  assert.equal(pendingInboxAttentionLevel(0, 'none'), 'none', 'attention level helper stays clear with no pending records');
  assert.equal(pendingInboxAttentionLevel(1, 'stale'), 'medium', 'attention level helper escalates stale pending records');
  assert.equal(pendingInboxAttentionLevel(1, 'old'), 'high', 'attention level helper escalates old pending records');
  assert.deepEqual(checkEnvJson.pending_inbox_names, ['pending-check.json'], 'check-env previews pending inbox names');
  assert.equal(checkEnvJson.first_pending_inbox_name, 'pending-check.json', 'check-env reports first pending inbox name');
  assert.equal(checkEnvJson.pending_inbox_next_name, 'pending-check.json', 'check-env aliases next pending inbox name');
  assert.ok(checkEnvJson.first_pending_inbox_path.endsWith('/pending-check.json'), 'check-env reports first pending inbox path');
  assert.equal(checkEnvJson.pending_inbox_next_path, checkEnvJson.first_pending_inbox_path, 'check-env aliases next pending inbox path');
  assert.ok(checkEnvJson.operator_next_check.includes('pending-check.json'), 'check-env next check points at the pending local inbox record');
  assert.equal(checkEnvJson.pending_inbox_needs_operator, true, 'check-env flags pending operator work');
  assert.equal(checkEnvJson.pending_inbox_attention_required, true, 'check-env flags pending inbox attention');
  assert.equal(checkEnvJson.next_inbox_status, 'pending_local_operator', 'check-env exposes next inbox status without requiring a live health probe');
  assert.equal(checkEnvJson.local_handoff_status, 'pending_local_operator', 'check-env exposes pending handoff status');
  assert.equal(checkEnvJson.local_handoff_required, true, 'check-env flags required local operator handoff');
  assert.equal(checkEnvJson.pending_inbox_preview_count, 1, 'check-env reports pending inbox preview count');
  assert.equal(checkEnvJson.pending_inbox_has_overflow, false, 'check-env reports pending preview overflow');
  assert.equal(checkEnvJson.pending_inbox_overflow_count, 0, 'check-env reports zero pending overflow');
  assert.equal(checkEnvJson.dispatch_path, '/baton/dispatch', 'check-env reports dispatch path');
  assert.equal(checkEnvJson.accepted_content_type, 'application/json', 'check-env reports dispatch content type');
  assert.deepEqual(checkEnvJson.accepted_methods, ['GET /health', 'HEAD /health', 'POST /baton/dispatch'], 'check-env reports accepted bridge methods');
  assert.equal(checkEnvJson.check_env_command, 'node scripts/nectar-dispatch-bridge.js --check-env', 'check-env reports its command');
  assert.equal(checkEnvJson.start_command, 'node scripts/nectar-dispatch-bridge.js', 'check-env reports bridge start command');
  assert.equal(checkEnvJson.next_inbox_command, 'node scripts/nectar-dispatch-bridge.js --next-inbox', 'check-env reports next-inbox command');
  assert.equal(checkEnvJson.next_inbox_path_command, 'node scripts/nectar-dispatch-bridge.js --next-inbox --path-only', 'check-env reports path-only next-inbox command');
  assert.equal(checkEnvJson.pending_inbox_review_command, 'node scripts/nectar-dispatch-bridge.js --next-inbox', 'check-env reports pending inbox review command when work is waiting');
  assert.equal(checkEnvJson.pending_inbox_path_command, 'node scripts/nectar-dispatch-bridge.js --next-inbox --path-only', 'check-env reports path-only pending inbox command when work is waiting');
  assert.equal(checkEnvJson.pending_inbox_next_prompt_command, 'node scripts/nectar-dispatch-bridge.js --next-inbox --prompt-only', 'check-env reports prompt-only command for next inbox handoff');
  assert.equal(checkEnvJson.safety_profile, 'private_local_inbox_only', 'check-env reports bridge safety profile');
  assert.deepEqual(checkEnvJson.verification_scope, ['config', 'auth_posture', 'inbox_path', 'pending_local_handoffs'], 'check-env exposes verification scope');
  assert.equal(checkEnvJson.verification_scope_count, 4, 'check-env exposes verification scope count');
  assert.match(checkEnvJson.bridge_instance_id, /^nectar_bridge_/, 'check-env exposes bridge instance id for traceability');
  assert.match(checkEnvJson.bridge_config_fingerprint, /^[a-f0-9]{64}$/, 'check-env exposes a stable safe config fingerprint');
  assert.equal(checkEnvJson.bridge_config_hash_algorithm, 'sha256', 'check-env reports config fingerprint algorithm');
  assert.equal(typeof checkEnvJson.process_pid, 'number', 'check-env exposes bridge process pid for local traceability');
  assert.equal(checkEnvJson.node_version, process.version, 'check-env exposes Node runtime version for reproducibility');
  const envConfig = bridgeConfigFromEnv({
    NECTAR_BRIDGE_PORT: String(randomPort(4820)),
    NECTAR_BRIDGE_HOST: '127.0.0.1',
    NECTAR_DISPATCH_INBOX: checkEnvInbox,
    NECTAR_BRIDGE_MAX_BODY_BYTES: '12345',
  });
  assert.equal(envConfig.maxBodyBytes, 12345, 'bridge config reads max body bytes from injected env');
  assert.equal(envConfig.inboxDir, checkEnvInbox, 'bridge config still reads inbox dir from injected env');
  const nextInbox = readNextInboxRecord({ host: '127.0.0.1', port: randomPort(4821), token: '', inboxDir: checkEnvInbox, maxBodyBytes: MAX_BODY_BYTES });
  assert.equal(nextInbox.schema_version, 'baton.nectar_bridge.next_inbox.v1', 'next-inbox exposes stable schema');
  assert.equal(nextInbox.ok, true, 'next-inbox helper succeeds for readable local pending record');
  assert.equal(nextInbox.next_inbox_status, 'pending_local_operator', 'next-inbox exposes a stable pending status');
  assert.equal(nextInbox.pending_inbox_count, 1, 'next-inbox reports pending local handoff count');
  assert.equal(nextInbox.pending_inbox_preview_limit, 5, 'next-inbox reports preview limit');
  assert.equal(nextInbox.pending_inbox_preview_count, 1, 'next-inbox reports preview count');
  assert.deepEqual(nextInbox.pending_inbox_names, ['pending-check.json'], 'next-inbox previews pending names');
  assert.equal(nextInbox.pending_inbox_has_overflow, false, 'next-inbox reports preview overflow state');
  assert.equal(nextInbox.pending_inbox_overflow_count, 0, 'next-inbox reports preview overflow count');
  assert.equal(nextInbox.pending_inbox_next_name, 'pending-check.json', 'next-inbox returns oldest pending record name');
  assert.ok(nextInbox.pending_inbox_next_path.endsWith('/pending-check.json'), 'next-inbox returns oldest pending record path');
  assert.match(nextInbox.pending_inbox_next_received_at, /^\d{4}-\d{2}-\d{2}T/, 'next-inbox reports the pending record receive timestamp');
  assert.equal(typeof nextInbox.pending_inbox_next_age_seconds, 'number', 'next-inbox reports pending record age seconds');
  assert.ok(['fresh', 'waiting', 'stale'].includes(nextInbox.pending_inbox_next_age_bucket), 'next-inbox reports pending age bucket');
  assert.equal(nextInbox.check_env_command, 'node scripts/nectar-dispatch-bridge.js --check-env', 'next-inbox reports check-env command');
  assert.equal(nextInbox.next_inbox_command, 'node scripts/nectar-dispatch-bridge.js --next-inbox', 'next-inbox reports its command');
  assert.equal(nextInbox.next_inbox_path_command, 'node scripts/nectar-dispatch-bridge.js --next-inbox --path-only', 'next-inbox reports path-only command');
  assert.equal(nextInbox.pending_inbox_review_command, 'node scripts/nectar-dispatch-bridge.js --next-inbox', 'next-inbox reports review command when pending work exists');
  assert.equal(nextInbox.pending_inbox_path_command, 'node scripts/nectar-dispatch-bridge.js --next-inbox --path-only', 'next-inbox reports path-only pending command when pending work exists');
  assert.match(nextInbox.inbox_record_sha256, /^[0-9a-f]{64}$/, 'next-inbox reports a stable inbox record hash');
  assert.equal(nextInbox.inbox_record_hash_algorithm, 'sha256', 'next-inbox reports inbox record hash algorithm');
  assert.equal(nextInbox.prompt, null, 'next-inbox keeps missing prompt explicit instead of inventing content');
  assert.equal(nextInbox.prompt_present, false, 'next-inbox reports prompt presence explicitly');
  assert.equal(nextInbox.prompt_length, 0, 'next-inbox reports zero prompt length when no prompt exists');
  const nextInboxCli = spawnSync(process.execPath, ['scripts/nectar-dispatch-bridge.js', '--next-inbox'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, NECTAR_DISPATCH_INBOX: checkEnvInbox, NECTAR_BRIDGE_PORT: String(randomPort(4825)) },
    encoding: 'utf8',
  });
  assert.equal(nextInboxCli.status, 0, 'Nectar bridge --next-inbox exits cleanly for readable local pending record');
  assert.equal(JSON.parse(nextInboxCli.stdout).pending_inbox_next_name, 'pending-check.json', '--next-inbox prints the next pending record as JSON');
  assert.equal(JSON.parse(nextInboxCli.stdout).next_inbox_status, 'pending_local_operator', '--next-inbox prints stable status as JSON');
  const nextInboxPathOnly = spawnSync(process.execPath, ['scripts/nectar-dispatch-bridge.js', '--next-inbox', '--path-only'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, NECTAR_DISPATCH_INBOX: checkEnvInbox, NECTAR_BRIDGE_PORT: String(randomPort(4827)) },
    encoding: 'utf8',
  });
  assert.equal(nextInboxPathOnly.status, 0, 'Nectar bridge --next-inbox --path-only exits cleanly');
  assert.ok(nextInboxPathOnly.stdout.endsWith('/pending-check.json\n'), '--path-only prints the oldest pending inbox path');
  const nextInboxMutuallyExclusive = spawnSync(process.execPath, ['scripts/nectar-dispatch-bridge.js', '--next-inbox', '--prompt-only', '--path-only'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, NECTAR_DISPATCH_INBOX: checkEnvInbox, NECTAR_BRIDGE_PORT: String(randomPort(4828)) },
    encoding: 'utf8',
  });
  assert.equal(nextInboxMutuallyExclusive.status, 2, 'Nectar bridge rejects mutually exclusive next-inbox output modes');
  assert.ok(nextInboxMutuallyExclusive.stderr.includes('mutually exclusive'), 'mutually exclusive next-inbox output modes explain the error');
  fs.writeFileSync(path.join(checkEnvInbox, 'pending-check.json'), JSON.stringify({ processing_status: 'pending_local_operator', received_at: new Date().toISOString(), prompt: 'Hand this to local Nectar.' }));
  const nextInboxPromptOnly = spawnSync(process.execPath, ['scripts/nectar-dispatch-bridge.js', '--next-inbox', '--prompt-only'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, NECTAR_DISPATCH_INBOX: checkEnvInbox, NECTAR_BRIDGE_PORT: String(randomPort(4826)) },
    encoding: 'utf8',
  });
  assert.equal(nextInboxPromptOnly.status, 0, 'Nectar bridge --next-inbox --prompt-only exits cleanly');
  assert.equal(nextInboxPromptOnly.stdout, 'Hand this to local Nectar.\n', '--prompt-only prints only the handoff prompt');
  fs.rmSync(checkEnvInbox, { recursive: true, force: true });
  const missingDefaultCheck = spawnSync(process.execPath, ['scripts/nectar-dispatch-bridge.js', '--check-env'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, NECTAR_DISPATCH_INBOX: path.join(tempDir || os.tmpdir(), 'missing-parent', 'nectar-inbox'), NECTAR_BRIDGE_PORT: String(randomPort(4810)) },
    encoding: 'utf8',
  });
  assert.equal(missingDefaultCheck.status, 0, 'check-env accepts creatable missing inbox parents without mutating them');
  const missingDefaultJson = JSON.parse(missingDefaultCheck.stdout);
  assert.equal(missingDefaultJson.check_env_status, 'ready', 'check-env reports ready when no pending inbox work exists');
  assert.equal(missingDefaultJson.inbox_exists, false, 'missing inbox remains absent during check-env');
  assert.equal(missingDefaultJson.inbox_creatable, true, 'check-env reports missing inbox as creatable');
  assert.equal(missingDefaultJson.inbox_record_count, 0, 'missing inbox has no records during check-env');
  assert.equal(missingDefaultJson.pending_inbox_count, 0, 'missing inbox has no pending records during check-env');
  assert.deepEqual(missingDefaultJson.inbox_processing_status_counts, {}, 'missing inbox has no status counts during check-env');
  assert.equal(missingDefaultJson.pending_inbox_attention_required, false, 'check-env leaves attention clear when no pending inbox work exists');
  assert.equal(missingDefaultJson.local_handoff_required, false, 'check-env leaves local handoff clear when no pending inbox work exists');
  assert.equal(missingDefaultJson.local_handoff_status, 'idle', 'check-env reports idle handoff status when no pending inbox work exists');
  assert.equal(isLoopbackHost('127.0.0.1'), true, 'loopback host helper accepts IPv4 loopback');
  assert.equal(isLoopbackHost('0.0.0.0'), false, 'loopback host helper rejects wildcard binds');
  assert.throws(
    () => startNectarDispatchBridge({ host: '0.0.0.0', port: randomPort(4900), token: '', inboxDir: path.join(os.tmpdir(), 'unused-nectar-inbox') }),
    /non-loopback Nectar bridge binds require NECTAR_DISPATCH_TOKEN/,
    'Nectar bridge refuses unauthenticated non-loopback binds',
  );
  const customLimitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baton-nectar-custom-limit-'));
  const customLimitBridge = await startNectarDispatchBridge({
    port: randomPort(4920),
    token: 'limit-test',
    inboxDir: customLimitDir,
    maxBodyBytes: 96,
  });
  try {
    const customHealth = await fetch(customLimitBridge.url.replace('/baton/dispatch', '/health'));
    assert.equal((await customHealth.json()).max_body_bytes, 96, 'bridge health reports per-instance max body bytes');
    const customOversized = await fetch(customLimitBridge.url, {
      method: 'POST',
      headers: { Authorization: 'Bearer limit-test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ schema: 'baton.dispatch.v1', padding: 'x'.repeat(160) }),
    });
    const customOversizedJson = await customOversized.json();
    assert.equal(customOversized.status, 413, 'Nectar bridge rejects bodies over the configured per-instance limit');
    assert.equal(customOversizedJson.rejection_code, 'body_too_large', 'custom body limit rejection has stable code');
  } finally {
    await new Promise(resolve => customLimitBridge.server.close(resolve));
    fs.rmSync(customLimitDir, { recursive: true, force: true });
  }
  const pendingHelperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baton-nectar-pending-helper-'));
  try {
    fs.writeFileSync(path.join(pendingHelperDir, 'done.json'), JSON.stringify({ processing_status: 'completed' }));
    fs.writeFileSync(path.join(pendingHelperDir, 'pending.json'), JSON.stringify({ processing_status: 'pending_local_operator' }));
    assert.deepEqual(pendingInboxRecordNames(pendingHelperDir), ['pending.json'], 'pending inbox helper excludes processed records');
    assert.deepEqual(
      inboxRecordProcessingStatusCounts(pendingHelperDir),
      { completed: 1, pending_local_operator: 1 },
      'inbox status-count helper summarizes local handoff states',
    );
    assert.equal(pendingInboxAttentionReason(0, 'none'), 'none', 'attention helper ignores empty inboxes');
    assert.equal(pendingInboxAttentionReason(1, 'fresh'), 'pending_inbox_waiting', 'attention helper reports fresh pending work');
    assert.equal(pendingInboxAttentionReason(1, 'stale'), 'pending_inbox_stale', 'attention helper escalates stale pending work');
  } finally {
    fs.rmSync(pendingHelperDir, { recursive: true, force: true });
  }

  await startBaton();

  const wrongContentType = await fetch(bridge.url, {
    method: 'POST',
    headers: { Authorization: 'Bearer test', 'Content-Type': 'text/plain' },
    body: JSON.stringify({ schema: 'baton.dispatch.v1' }),
  });
  const wrongContentTypeJson = await wrongContentType.json();
  assert.equal(wrongContentType.status, 415, 'Nectar bridge rejects non-JSON content types');
  assert.equal(wrongContentTypeJson.schema_version, 'baton.nectar_bridge.dispatch_result.v1', 'rejection response exposes dispatch result schema');
  assert.equal(wrongContentTypeJson.bridge_version, '0.1.0', 'rejection response exposes bridge version');
  assert.match(wrongContentTypeJson.bridge_request_id, /^nectar_req_/, 'rejection response exposes request id');
  assert.equal(typeof wrongContentTypeJson.process_pid, 'number', 'rejection response exposes bridge process pid');
  assert.equal(wrongContentTypeJson.node_version, process.version, 'rejection response exposes Node runtime version');
  assert.match(wrongContentTypeJson.generated_at, /^\d{4}-\d{2}-\d{2}T/, 'rejection response exposes timestamp');
  assert.equal(wrongContentTypeJson.error_count, 1, 'rejection response exposes error count');
  assert.equal(wrongContentTypeJson.rejection_code, 'unsupported_content_type', 'rejection response exposes stable rejection code');
  assert.equal(wrongContentTypeJson.operator_next_check, 'fix the dispatch client request encoding before retrying the handoff', 'rejection response exposes next operator check');
  assert.deepEqual(wrongContentTypeJson.errors, ['content-type must be application/json'], 'non-JSON content type has explicit rejection reason');

  const malformed = await fetch(bridge.url, {
    method: 'POST',
    headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    body: '{not-json',
  });
  const malformedJson = await malformed.json();
  assert.equal(malformed.status, 400, 'Nectar bridge rejects malformed JSON');
  assert.deepEqual(malformedJson.errors, ['invalid json'], 'malformed JSON has explicit rejection reason');
  assert.equal(malformedJson.rejection_code, 'invalid_json', 'malformed JSON has stable rejection code');


  const nonObject = await fetch(bridge.url, {
    method: 'POST',
    headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    body: 'null',
  });
  const nonObjectJson = await nonObject.json();
  assert.equal(nonObject.status, 400, 'Nectar bridge rejects non-object JSON bodies');
  assert.deepEqual(nonObjectJson.errors, ['body must be a JSON object'], 'non-object JSON has explicit rejection reason');
  assert.equal(nonObjectJson.rejection_code, 'invalid_body_type', 'non-object JSON has stable rejection code');

  const oversized = await fetch(bridge.url, {
    method: 'POST',
    headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ schema: 'baton.dispatch.v1', padding: 'x'.repeat(MAX_BODY_BYTES + 1) }),
  });
  const oversizedJson = await oversized.json();
  assert.equal(oversized.status, 413, 'Nectar bridge rejects oversized bodies');
  assert.deepEqual(oversizedJson.errors, ['body too large'], 'oversized body has explicit rejection reason');
  assert.equal(oversizedJson.rejection_code, 'body_too_large', 'oversized body has stable rejection code');

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
  assert.equal(credentialCallbackJson.rejection_code, 'invalid_callback_url', 'credential callback URL has stable rejection code');
  assert.equal(credentialCallbackJson.operator_next_check, 'fix callback URLs and keep credentials out of URL userinfo before retrying', 'callback rejection guides next operator check');
  assert.equal(credentialCallbackJson.safety_profile, 'private_local_inbox_only', 'rejections expose bridge safety profile');

  const initialHealth = await fetch(`${bridge.url.replace('/baton/dispatch', '')}/health`);
  const initialHealthJson = await initialHealth.json();
  const initialHealthHead = await fetch(`${bridge.url.replace('/baton/dispatch', '')}/health`, { method: 'HEAD' });
  assert.equal(initialHealthHead.status, 200, 'Nectar bridge supports HEAD health probes');
  assert.equal(await initialHealthHead.text(), '', 'Nectar bridge HEAD health returns no response body');
  assert.equal(initialHealth.headers.get('cache-control'), 'no-store', 'Nectar bridge health disables caching');
  assert.equal(initialHealthHead.headers.get('cache-control'), 'no-store', 'Nectar bridge HEAD health disables caching');
  assert.equal(initialHealthJson.bind_host, '127.0.0.1', 'Nectar bridge health exposes bind host');
  assert.equal(initialHealthJson.accepted_content_type, 'application/json', 'Nectar bridge health exposes dispatch content type');
  assert.deepEqual(initialHealthJson.accepted_methods, ['GET /health', 'HEAD /health', 'POST /baton/dispatch'], 'Nectar bridge health exposes accepted methods');
  assert.equal(initialHealthJson.check_env_command, 'node scripts/nectar-dispatch-bridge.js --check-env', 'Nectar bridge health reports check-env command');
  assert.equal(initialHealthJson.start_command, 'node scripts/nectar-dispatch-bridge.js', 'Nectar bridge health reports start command');
  assert.equal(initialHealthJson.next_inbox_command, 'node scripts/nectar-dispatch-bridge.js --next-inbox', 'Nectar bridge health reports next-inbox command');
  assert.equal(initialHealthJson.pending_inbox_review_command, null, 'Nectar bridge health omits review command when no pending inbox work exists');
  assert.equal(initialHealthJson.health_schema_version, 'baton.nectar_bridge.health.v1', 'Nectar bridge health exposes stable health schema');
  assert.equal(initialHealthJson.bridge_version, '0.1.0', 'Nectar bridge health exposes package version');
  assert.match(initialHealthJson.bridge_instance_id, /^nectar_bridge_/, 'Nectar bridge health exposes bridge instance id');
  assert.match(initialHealthJson.bridge_config_fingerprint, /^[a-f0-9]{64}$/, 'Nectar bridge health exposes a safe config fingerprint');
  assert.equal(initialHealthJson.bridge_config_hash_algorithm, 'sha256', 'Nectar bridge health reports config fingerprint algorithm');
  assert.equal(typeof initialHealthJson.process_pid, 'number', 'Nectar bridge health exposes bridge process pid');
  assert.equal(initialHealthJson.node_version, process.version, 'Nectar bridge health exposes Node runtime version');
  assert.equal(initialHealthJson.safety_profile, 'private_local_inbox_only', 'Nectar bridge health exposes safety profile');
  assert.match(initialHealthJson.generated_at, /^\d{4}-\d{2}-\d{2}T/, 'Nectar bridge health exposes response timestamp');
  assert.equal(initialHealthJson.dispatch_path, '/baton/dispatch', 'Nectar bridge health exposes dispatch path');
  assert.equal(initialHealthJson.dispatch_url, bridge.url, 'Nectar bridge health exposes full dispatch URL');
  assert.equal(initialHealthJson.token_required, true, 'Nectar bridge health exposes whether auth is required');
  assert.equal(initialHealthJson.bridge_status, 'needs_client_fix', 'Nectar bridge health summarizes rejected pre-dispatch state');
  assert.equal(initialHealthJson.next_inbox_status, 'empty', 'Nectar bridge health exposes empty next-inbox status before dispatch');
  assert.deepEqual(initialHealthJson.verification_scope, ['service_status', 'auth_posture', 'inbox_status', 'handoff_traceability'], 'Nectar bridge health exposes verification scope');
  assert.equal(initialHealthJson.verification_scope_count, 4, 'Nectar bridge health exposes verification scope count');
  assert.match(initialHealthJson.latest_activity_at, /^\d{4}-\d{2}-\d{2}T/, 'Nectar bridge health exposes latest activity timestamp');
  assert.equal(initialHealthJson.latest_activity_source, 'rejected', 'Nectar bridge health exposes latest activity source after rejection');
  assert.equal(typeof initialHealthJson.latest_activity_age_seconds, 'number', 'Nectar bridge health exposes latest activity age seconds');
  assert.ok(initialHealthJson.latest_activity_age_seconds >= 0, 'Nectar bridge latest activity age is non-negative');
  assert.match(initialHealthJson.started_at, /^\d{4}-\d{2}-\d{2}T/, 'Nectar bridge health exposes start timestamp');
  assert.equal(typeof initialHealthJson.uptime_seconds, 'number', 'Nectar bridge health exposes uptime seconds');
  assert.ok(initialHealthJson.uptime_seconds >= 0, 'Nectar bridge uptime is non-negative');
  assert.equal(initialHealthJson.received_count, 0, 'Nectar bridge health exposes received count before dispatch');
  assert.equal(initialHealthJson.rejected_count, 6, 'Nectar bridge health exposes rejection count before dispatch');
  assert.equal(initialHealthJson.inbox_record_count, 0, 'Nectar bridge health exposes inbox record count before dispatch');
  assert.equal(initialHealthJson.pending_inbox_count, 0, 'Nectar bridge health exposes pending inbox count before dispatch');
  assert.equal(initialHealthJson.pending_inbox_attention_reason, 'none', 'Nectar bridge health exposes pending inbox attention reason');
  assert.equal(initialHealthJson.pending_inbox_attention_level, 'none', 'Nectar bridge health exposes pending inbox attention level');
  assert.deepEqual(initialHealthJson.inbox_processing_status_counts, {}, 'Nectar bridge health exposes empty inbox status counts before dispatch');
  assert.equal(initialHealthJson.pending_inbox_preview_limit, 5, 'Nectar bridge health exposes pending inbox preview limit');
  assert.equal(initialHealthJson.pending_inbox_preview_count, 0, 'Nectar bridge health exposes pending inbox preview count before dispatch');
  assert.equal(initialHealthJson.pending_inbox_has_overflow, false, 'Nectar bridge health exposes no pending inbox preview overflow before dispatch');
  assert.equal(initialHealthJson.pending_inbox_needs_operator, false, 'Nectar bridge health exposes no pending operator work before dispatch');
  assert.equal(initialHealthJson.pending_inbox_attention_required, false, 'Nectar bridge health exposes no pending attention before dispatch');
  assert.equal(initialHealthJson.local_handoff_status, 'idle', 'Nectar bridge health exposes idle handoff status before dispatch');
  assert.deepEqual(initialHealthJson.pending_inbox_paths, [], 'Nectar bridge health exposes no pending inbox paths before dispatch');
  assert.equal(initialHealthJson.first_pending_inbox_name, null, 'Nectar bridge health has no first pending inbox before dispatch');
  assert.equal(initialHealthJson.first_pending_inbox_path, null, 'Nectar bridge health has no first pending inbox path before dispatch');
  assert.equal(initialHealthJson.pending_inbox_next_name, null, 'Nectar bridge health has no next pending inbox before dispatch');
  assert.equal(initialHealthJson.pending_inbox_next_path, null, 'Nectar bridge health has no next pending inbox path before dispatch');
  assert.equal(initialHealthJson.pending_inbox_oldest_name, null, 'Nectar bridge health has no oldest pending inbox before dispatch');
  assert.equal(initialHealthJson.pending_inbox_oldest_path, null, 'Nectar bridge health has no oldest pending inbox path before dispatch');
  assert.equal(initialHealthJson.pending_inbox_oldest_received_at, null, 'Nectar bridge health has no oldest pending inbox timestamp before dispatch');
  assert.equal(initialHealthJson.pending_inbox_oldest_age_seconds, null, 'Nectar bridge health has no oldest pending inbox age before dispatch');
  assert.equal(initialHealthJson.pending_inbox_oldest_age_bucket, 'none', 'Nectar bridge health buckets missing pending inbox age');
  assert.equal(initialHealthJson.pending_inbox_newest_name, null, 'Nectar bridge health has no newest pending inbox before dispatch');
  assert.equal(initialHealthJson.pending_inbox_newest_path, null, 'Nectar bridge health has no newest pending inbox path before dispatch');
  assert.equal(initialHealthJson.pending_inbox_newest_received_at, null, 'Nectar bridge health has no newest pending inbox timestamp before dispatch');
  assert.equal(initialHealthJson.pending_inbox_newest_age_seconds, null, 'Nectar bridge health has no newest pending inbox age before dispatch');
  assert.equal(initialHealthJson.pending_inbox_newest_age_bucket, 'none', 'Nectar bridge health buckets missing newest pending inbox age');
  assert.match(initialHealthJson.inbox_dir, /nectar-inbox$/, 'Nectar bridge health exposes configured inbox directory');
  assert.equal(initialHealthJson.inbox_record_schema_version, 'baton.nectar_bridge.inbox_record.v1', 'Nectar bridge health exposes inbox record schema');
  assert.equal(initialHealthJson.inbox_writable, true, 'Nectar bridge health exposes writable inbox state');
  assert.equal(initialHealthJson.last_received_at, null, 'Nectar bridge health has no last received timestamp before dispatch');
  assert.equal(initialHealthJson.last_received_dispatch_id, null, 'Nectar bridge health has no last dispatch id before dispatch');
  assert.equal(initialHealthJson.last_received_run_id, null, 'Nectar bridge health has no last run id before dispatch');
  assert.equal(initialHealthJson.last_received_task_id, null, 'Nectar bridge health has no last task id before dispatch');
  assert.equal(initialHealthJson.last_received_touch_id, null, 'Nectar bridge health has no last touch id before dispatch');
  assert.equal(initialHealthJson.last_inbox_path, null, 'Nectar bridge health has no last inbox path before dispatch');
  assert.equal(initialHealthJson.last_inbox_name, null, 'Nectar bridge health has no last inbox name before dispatch');
  assert.equal(initialHealthJson.last_inbox_processing_status, null, 'Nectar bridge health has no last inbox processing status before dispatch');
  assert.equal(initialHealthJson.last_prompt_sha256, null, 'Nectar bridge health has no last prompt hash before dispatch');
  assert.equal(initialHealthJson.last_prompt_hash_algorithm, null, 'Nectar bridge health has no prompt hash algorithm before dispatch');
  assert.match(initialHealthJson.last_rejected_at, /^\d{4}-\d{2}-\d{2}T/, 'Nectar bridge health exposes last rejection timestamp');
  assert.equal(initialHealthJson.last_rejection_status, 400, 'Nectar bridge health exposes last rejection status');
  assert.ok(initialHealthJson.last_rejection_reason.includes('ack_url must not include credentials'), 'Nectar bridge health exposes last rejection reason');
  assert.equal(initialHealthJson.last_rejection_code, 'invalid_callback_url', 'Nectar bridge health exposes last rejection code');
  assert.match(initialHealthJson.last_rejection_request_id, /^nectar_req_/, 'Nectar bridge health exposes last rejection request id');
  assert.deepEqual(initialHealthJson.last_rejection_errors, ['ack_url must not include credentials'], 'Nectar bridge health exposes structured last rejection errors');
  assert.equal(initialHealthJson.last_rejection_error_count, 1, 'Nectar bridge health exposes last rejection error count');
  assert.equal(initialHealthJson.max_body_bytes, MAX_BODY_BYTES, 'Nectar bridge health exposes max body bytes');
  assert.equal(initialHealthJson.operator_next_check, 'fix the last_rejection_errors in the dispatch client, then retry the handoff', 'Nectar bridge health exposes next operator check after rejections');

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
  assert.equal(live.ack.schema_version, 'baton.nectar_bridge.dispatch_result.v1', 'accepted bridge response exposes dispatch result schema');
  assert.equal(live.ack.bridge_version, '0.1.0', 'accepted bridge response exposes bridge version');
  assert.equal(live.ack.bridge_instance_id, initialHealthJson.bridge_instance_id, 'accepted bridge response echoes bridge instance id');
  assert.match(live.ack.bridge_request_id, /^nectar_req_/, 'accepted bridge response exposes request id');
  assert.equal(live.ack.safety_profile, 'private_local_inbox_only', 'accepted bridge response exposes safety profile');
  assert.match(live.ack.generated_at, /^\d{4}-\d{2}-\d{2}T/, 'accepted bridge response exposes timestamp');
  assert.equal(bridge.received.length, 1, 'Nectar bridge received one envelope');
  assert.equal(live.ack.dispatch_id, bridge.received[0].envelope.dispatch_id, 'accepted bridge response echoes dispatch id');
  assert.equal(live.ack.run_id, bridge.received[0].envelope.run_id, 'accepted bridge response echoes run id');
  assert.equal(live.ack.task_id, bridge.received[0].envelope.task_id, 'accepted bridge response echoes task id');
  assert.equal(live.ack.touch_id, bridge.received[0].envelope.touch_id, 'accepted bridge response echoes touch id');
  assert.equal(live.ack.received_count, 1, 'accepted bridge response exposes in-memory received count');
  assert.equal(live.ack.inbox_record_count, 1, 'accepted bridge response exposes inbox record count');
  assert.equal(live.ack.pending_inbox_count, 1, 'accepted bridge response exposes pending inbox count');
  assert.deepEqual(live.ack.inbox_processing_status_counts, { pending_local_operator: 1 }, 'accepted bridge response exposes inbox status counts');
  assert.equal(live.ack.pending_inbox_needs_operator, true, 'accepted bridge response flags pending local operator work');
  assert.equal(live.ack.pending_inbox_attention_required, true, 'accepted bridge response flags pending local attention');
  assert.equal(live.ack.pending_inbox_attention_reason, 'pending_inbox_waiting', 'accepted bridge response explains pending inbox attention');
  assert.equal(live.ack.pending_inbox_attention_level, 'low', 'accepted bridge response exposes pending inbox attention level');
  assert.equal(live.ack.local_handoff_required, true, 'accepted bridge response flags local handoff requirement');
  assert.equal(live.ack.local_handoff_status, 'pending_local_operator', 'accepted bridge response exposes pending handoff status');
  assert.equal(live.ack.pending_inbox_preview_limit, 5, 'accepted bridge response exposes pending inbox preview limit');
  assert.equal(live.ack.pending_inbox_preview_count, 1, 'accepted bridge response exposes pending inbox preview count');
  assert.deepEqual(live.ack.pending_inbox_names, [live.ack.inbox_record_name], 'accepted bridge response exposes pending inbox names');
  assert.deepEqual(live.ack.pending_inbox_paths, [live.ack.inbox_path], 'accepted bridge response exposes pending inbox paths');
  assert.equal(live.ack.pending_inbox_overflow_count, 0, 'accepted bridge response exposes pending inbox overflow count');
  assert.equal(live.ack.pending_inbox_has_overflow, false, 'accepted bridge response exposes pending inbox overflow boolean');
  assert.equal(live.ack.inbox_record_schema_version, 'baton.nectar_bridge.inbox_record.v1', 'accepted bridge response exposes inbox record schema');
  assert.match(live.ack.inbox_record_name, /^run_[a-f0-9-]+-dispatch_[a-f0-9-]+\.json$/, 'accepted bridge response exposes inbox record filename');
  assert.equal(live.ack.first_pending_inbox_name, live.ack.inbox_record_name, 'accepted bridge response exposes next pending inbox filename');
  assert.ok(live.ack.first_pending_inbox_path.endsWith(live.ack.inbox_record_name), 'accepted bridge response exposes next pending inbox path');
  assert.equal(live.ack.pending_inbox_next_name, live.ack.inbox_record_name, 'accepted bridge response exposes explicit next pending inbox filename');
  assert.ok(live.ack.pending_inbox_next_path.endsWith(live.ack.inbox_record_name), 'accepted bridge response exposes explicit next pending inbox path');
  assert.equal(live.ack.pending_inbox_oldest_name, live.ack.inbox_record_name, 'accepted bridge response exposes oldest pending inbox filename');
  assert.ok(live.ack.pending_inbox_oldest_path.endsWith(live.ack.inbox_record_name), 'accepted bridge response exposes oldest pending inbox path');
  assert.match(live.ack.pending_inbox_oldest_received_at, /^\d{4}-\d{2}-\d{2}T/, 'accepted bridge response exposes oldest pending inbox timestamp');
  assert.equal(typeof live.ack.pending_inbox_oldest_age_seconds, 'number', 'accepted bridge response exposes oldest pending inbox age');
  assert.ok(live.ack.pending_inbox_oldest_age_seconds >= 0, 'accepted bridge oldest pending age is non-negative');
  assert.equal(live.ack.pending_inbox_oldest_age_bucket, 'fresh', 'accepted bridge response buckets fresh oldest pending inbox age');
  assert.equal(live.ack.pending_inbox_newest_name, live.ack.inbox_record_name, 'accepted bridge response exposes newest pending inbox filename');
  assert.ok(live.ack.pending_inbox_newest_path.endsWith(live.ack.inbox_record_name), 'accepted bridge response exposes newest pending inbox path');
  assert.match(live.ack.pending_inbox_newest_received_at, /^\d{4}-\d{2}-\d{2}T/, 'accepted bridge response exposes newest pending inbox timestamp');
  assert.equal(typeof live.ack.pending_inbox_newest_age_seconds, 'number', 'accepted bridge response exposes newest pending inbox age');
  assert.ok(live.ack.pending_inbox_newest_age_seconds >= 0, 'accepted bridge newest pending age is non-negative');
  assert.equal(live.ack.pending_inbox_newest_age_bucket, 'fresh', 'accepted bridge response buckets fresh newest pending inbox age');
  assert.equal(live.ack.inbox_processing_status, 'pending_local_operator', 'accepted bridge response exposes inbox processing state');
  assert.equal(live.ack.next_inbox_command, 'node scripts/nectar-dispatch-bridge.js --next-inbox', 'accepted bridge response reports next-inbox command');
  assert.equal(live.ack.pending_inbox_review_command, 'node scripts/nectar-dispatch-bridge.js --next-inbox', 'accepted bridge response reports pending inbox review command');
  assert.equal(live.ack.pending_inbox_next_prompt_command, 'node scripts/nectar-dispatch-bridge.js --next-inbox --prompt-only', 'accepted bridge response reports prompt-only command for next inbox handoff');
  assert.match(live.ack.prompt_sha256, /^[a-f0-9]{64}$/, 'accepted bridge response exposes prompt sha256');
  assert.equal(live.ack.prompt_hash_algorithm, 'sha256', 'accepted bridge response exposes prompt hash algorithm');
  assert.equal(live.ack.operator_next_check, 'open the inbox record or hand the generated prompt to local Nectar/OpenClaw for processing', 'accepted bridge response exposes next operator check');

  const duplicateDispatch = await fetch(bridge.url, {
    method: 'POST',
    headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    body: JSON.stringify(bridge.received[0].envelope),
  });
  const duplicateDispatchJson = await duplicateDispatch.json();
  assert.equal(duplicateDispatch.status, 409, 'Nectar bridge rejects duplicate inbox records without overwriting local prompts');
  assert.equal(duplicateDispatchJson.rejection_code, 'duplicate_dispatch', 'duplicate dispatch has stable rejection code');
  assert.equal(duplicateDispatchJson.inbox_record_name, live.ack.inbox_record_name, 'duplicate dispatch points at existing inbox record');
  assert.equal(duplicateDispatchJson.operator_next_check, 'open the existing inbox_record_name instead of retrying the same dispatch', 'duplicate dispatch guides operator to existing prompt');

  const finalHealth = await fetch(`${bridge.url.replace('/baton/dispatch', '')}/health`);
  const finalHealthJson = await finalHealth.json();
  assert.equal(finalHealthJson.received_count, 1, 'Nectar bridge health updates received count after dispatch');
  assert.equal(finalHealthJson.rejected_count, 7, 'Nectar bridge health tracks duplicate rejection after dispatch');
  assert.equal(finalHealthJson.bridge_status, 'ready_to_process', 'Nectar bridge health summarizes ready inbox state after dispatch');
  assert.equal(finalHealthJson.next_inbox_status, 'pending_local_operator', 'Nectar bridge health exposes pending next-inbox status after dispatch');
  assert.match(finalHealthJson.latest_activity_at, /^\d{4}-\d{2}-\d{2}T/, 'Nectar bridge final health exposes latest activity timestamp');
  assert.equal(finalHealthJson.latest_activity_source, 'rejected', 'Nectar bridge final health points at duplicate rejection as latest activity');
  assert.equal(typeof finalHealthJson.latest_activity_age_seconds, 'number', 'Nectar bridge final health exposes latest activity age seconds');
  assert.equal(finalHealthJson.inbox_record_count, 1, 'Nectar bridge health updates inbox record count after dispatch');
  assert.equal(finalHealthJson.pending_inbox_count, 1, 'Nectar bridge health updates pending inbox count after dispatch');
  assert.equal(finalHealthJson.pending_inbox_attention_reason, 'pending_inbox_waiting', 'Nectar bridge health reports pending attention reason after dispatch');
  assert.deepEqual(finalHealthJson.inbox_processing_status_counts, { pending_local_operator: 1 }, 'Nectar bridge health exposes inbox status counts after dispatch');
  assert.equal(finalHealthJson.pending_inbox_needs_operator, true, 'Nectar bridge health flags pending local operator work after dispatch');
  assert.equal(finalHealthJson.pending_inbox_attention_required, true, 'Nectar bridge health flags pending local attention after dispatch');
  assert.equal(finalHealthJson.local_handoff_required, true, 'Nectar bridge health flags local handoff requirement after dispatch');
  assert.equal(finalHealthJson.local_handoff_status, 'pending_local_operator', 'Nectar bridge health exposes pending handoff status after dispatch');
  assert.equal(finalHealthJson.pending_inbox_preview_limit, 5, 'Nectar bridge health keeps exposing pending inbox preview limit');
  assert.equal(finalHealthJson.pending_inbox_preview_count, 1, 'Nectar bridge health exposes pending inbox preview count after dispatch');
  assert.deepEqual(finalHealthJson.pending_inbox_names, [live.ack.inbox_record_name], 'Nectar bridge health exposes pending inbox names');
  assert.deepEqual(finalHealthJson.pending_inbox_paths, [live.ack.inbox_path], 'Nectar bridge health exposes pending inbox paths');
  assert.equal(finalHealthJson.pending_inbox_overflow_count, 0, 'Nectar bridge health exposes pending inbox overflow count');
  assert.equal(finalHealthJson.pending_inbox_has_overflow, false, 'Nectar bridge health exposes pending inbox overflow boolean after dispatch');
  assert.equal(finalHealthJson.first_pending_inbox_name, live.ack.inbox_record_name, 'Nectar bridge health exposes next pending inbox filename');
  assert.ok(finalHealthJson.first_pending_inbox_path.endsWith(live.ack.inbox_record_name), 'Nectar bridge health exposes next pending inbox path');
  assert.equal(finalHealthJson.pending_inbox_next_name, live.ack.inbox_record_name, 'Nectar bridge health exposes explicit next pending inbox filename');
  assert.ok(finalHealthJson.pending_inbox_next_path.endsWith(live.ack.inbox_record_name), 'Nectar bridge health exposes explicit next pending inbox path');
  assert.equal(finalHealthJson.pending_inbox_next_prompt_command, 'node scripts/nectar-dispatch-bridge.js --next-inbox --prompt-only', 'Nectar bridge health exposes prompt-only command for next inbox handoff');
  assert.equal(finalHealthJson.pending_inbox_oldest_name, live.ack.inbox_record_name, 'Nectar bridge health exposes oldest pending inbox filename');
  assert.ok(finalHealthJson.pending_inbox_oldest_path.endsWith(live.ack.inbox_record_name), 'Nectar bridge health exposes oldest pending inbox path');
  assert.match(finalHealthJson.pending_inbox_oldest_received_at, /^\d{4}-\d{2}-\d{2}T/, 'Nectar bridge health exposes oldest pending inbox timestamp');
  assert.equal(typeof finalHealthJson.pending_inbox_oldest_age_seconds, 'number', 'Nectar bridge health exposes oldest pending inbox age');
  assert.ok(finalHealthJson.pending_inbox_oldest_age_seconds >= 0, 'Nectar bridge oldest pending age is non-negative');
  assert.equal(finalHealthJson.pending_inbox_oldest_age_bucket, 'fresh', 'Nectar bridge health buckets fresh pending inbox age');
  assert.equal(finalHealthJson.pending_inbox_newest_name, live.ack.inbox_record_name, 'Nectar bridge health exposes newest pending inbox filename');
  assert.ok(finalHealthJson.pending_inbox_newest_path.endsWith(live.ack.inbox_record_name), 'Nectar bridge health exposes newest pending inbox path');
  assert.match(finalHealthJson.pending_inbox_newest_received_at, /^\d{4}-\d{2}-\d{2}T/, 'Nectar bridge health exposes newest pending inbox timestamp');
  assert.equal(typeof finalHealthJson.pending_inbox_newest_age_seconds, 'number', 'Nectar bridge health exposes newest pending inbox age');
  assert.ok(finalHealthJson.pending_inbox_newest_age_seconds >= 0, 'Nectar bridge newest pending age is non-negative');
  assert.equal(finalHealthJson.pending_inbox_newest_age_bucket, 'fresh', 'Nectar bridge health buckets fresh newest pending inbox age');
  assert.equal(finalHealthJson.inbox_writable, true, 'Nectar bridge inbox remains writable after dispatch');
  assert.match(finalHealthJson.last_received_at, /^\d{4}-\d{2}-\d{2}T/, 'Nectar bridge health exposes last received timestamp');
  assert.equal(finalHealthJson.last_received_dispatch_id, bridge.received[0].envelope.dispatch_id, 'Nectar bridge health exposes last dispatch id');
  assert.equal(finalHealthJson.last_received_request_id, live.ack.bridge_request_id, 'Nectar bridge health exposes last received request id');
  assert.equal(finalHealthJson.operator_next_check, 'open last_inbox_path and hand the generated prompt to local Nectar/OpenClaw', 'Nectar bridge health updates next operator check after dispatch');
  assert.equal(finalHealthJson.last_received_run_id, bridge.received[0].envelope.run_id, 'Nectar bridge health exposes last run id');
  assert.equal(finalHealthJson.last_received_task_id, bridge.received[0].envelope.task_id, 'Nectar bridge health exposes last task id');
  assert.equal(finalHealthJson.last_received_touch_id, bridge.received[0].envelope.touch_id, 'Nectar bridge health exposes last touch id');
  assert.match(finalHealthJson.last_inbox_path, /^local\/nectar-dispatch-inbox|^\.\.\//, 'Nectar bridge health exposes last inbox path');
  assert.equal(finalHealthJson.last_inbox_name, live.ack.inbox_record_name, 'Nectar bridge health exposes last inbox filename');
  assert.equal(finalHealthJson.last_inbox_processing_status, 'pending_local_operator', 'Nectar bridge health exposes last inbox processing status');
  assert.equal(finalHealthJson.last_prompt_sha256, live.ack.prompt_sha256, 'Nectar bridge health exposes last prompt hash');
  assert.equal(finalHealthJson.last_prompt_hash_algorithm, live.ack.prompt_hash_algorithm, 'Nectar bridge health exposes prompt hash algorithm');

  const files = fs.readdirSync(bridge.inboxDir).filter(file => file.endsWith('.json'));
  assert.equal(files.length, 1, 'Nectar bridge wrote one inbox record');
  const record = JSON.parse(fs.readFileSync(path.join(bridge.inboxDir, files[0]), 'utf8'));
  assert.equal(record.schema_version, 'baton.nectar_bridge.inbox_record.v1', 'inbox record exposes stable schema');
  assert.equal(record.bridge_instance_id, initialHealthJson.bridge_instance_id, 'inbox record carries bridge instance id');
  assert.equal(record.bridge_request_id, live.ack.bridge_request_id, 'inbox record carries accepted request id');
  assert.equal(record.safety_profile, 'private_local_inbox_only', 'inbox record carries safety profile');
  assert.equal(record.inbox_record_name, live.ack.inbox_record_name, 'inbox record carries its stable filename');
  assert.equal(record.prompt_sha256, live.ack.prompt_sha256, 'inbox record carries prompt sha256');
  assert.equal(record.prompt_hash_algorithm, 'sha256', 'inbox record carries prompt hash algorithm');
  assert.equal(crypto.createHash('sha256').update(record.prompt).digest('hex'), record.prompt_sha256, 'inbox record prompt hash matches prompt body');
  assert.equal(record.processing_status, 'pending_local_operator', 'inbox record starts in explicit pending state');
  assert.equal(record.operator_next_check, 'hand prompt to local Nectar/OpenClaw, then update BATON callbacks only after real work completes', 'inbox record carries local operator handoff guidance');
  assert.equal(record.envelope.agent_id, 'nectar', 'inbox record stores Nectar envelope');
  assert.equal(record.envelope.constraints.do_not_expose_private_context, true, 'envelope carries private-context safety constraint');
  assert.equal(record.envelope.constraints.do_not_share_callback_urls_or_tokens, true, 'envelope carries callback secrecy safety constraint');
  assert.ok(record.prompt.includes('BATON dispatch received for Nectar'), 'inbox record includes OpenClaw-ready prompt');
  assert.ok(record.prompt.includes(`Dispatch: ${record.envelope.dispatch_id}`), 'prompt includes dispatch id for traceability');
  assert.ok(record.prompt.includes(`Touch: ${record.envelope.touch_id}`), 'prompt includes touch id for traceability');
  assert.ok(record.prompt.includes(`- ack_url: ${record.envelope.callbacks.ack_url}`), 'prompt includes ack callback');
  assert.ok(record.prompt.includes(`- status_url: ${record.envelope.callbacks.status_url}`), 'prompt includes status callback');
  assert.ok(record.prompt.includes(`- review_packet_url: ${record.envelope.callbacks.review_packet_url}`), 'prompt includes review packet callback');
  assert.ok(record.prompt.includes('Local safety:'), 'prompt includes local safety section');
  assert.ok(record.prompt.includes('do not publish the envelope'), 'prompt warns against exposing private handoff context');

  record.processing_status = 'completed_local_operator';
  fs.writeFileSync(path.join(bridge.inboxDir, files[0]), JSON.stringify(record, null, 2));
  const completedHealth = await fetch(`${bridge.url.replace('/baton/dispatch', '')}/health`);
  const completedHealthJson = await completedHealth.json();
  assert.equal(completedHealthJson.inbox_record_count, 1, 'Nectar bridge health keeps total inbox count after local completion');
  assert.equal(completedHealthJson.pending_inbox_count, 0, 'Nectar bridge health excludes completed records from pending count');
  assert.deepEqual(completedHealthJson.inbox_processing_status_counts, { completed_local_operator: 1 }, 'Nectar bridge health counts completed local records separately');
  assert.equal(completedHealthJson.pending_inbox_needs_operator, false, 'Nectar bridge health clears pending operator flag after local completion');
  assert.equal(completedHealthJson.pending_inbox_attention_required, false, 'Nectar bridge health clears pending attention after local completion');
  assert.equal(completedHealthJson.local_handoff_required, false, 'Nectar bridge health clears local handoff requirement after local completion');
  assert.equal(completedHealthJson.local_handoff_status, 'idle', 'Nectar bridge health returns to idle handoff status after local completion');
  assert.deepEqual(completedHealthJson.pending_inbox_names, [], 'Nectar bridge health clears pending inbox names after local completion');

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
