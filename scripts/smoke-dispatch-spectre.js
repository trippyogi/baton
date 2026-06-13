#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { startFakeSpectre } = require('./fake-spectre');

let baton = null;
let fake = null;
let tempDir = null;
let batonOut = '';
let batonErr = '';
let BASE = '';

async function request(path, { method = 'GET', body, ok = true, headers = {} } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json', ...headers } : headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) {}
  if (ok && !res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
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

async function startBaton(extraEnv = {}) {
  const port = String(5600 + Math.floor(Math.random() * 500));
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baton-dispatch-'));
  BASE = `http://127.0.0.1:${port}`;
  baton = spawn(process.execPath, ['server/index.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      VMC_PORT: port,
      BATON_PUBLIC_BASE_URL: BASE,
      BATON_DB_PATH: path.join(tempDir, 'dispatch.db'),
      REDIS_URL: 'redis://127.0.0.1:0',
      SPECTRE_DISPATCH_TOKEN: 'change-me',
      BATON_CALLBACK_TOKEN: 'callback-token',
      SPECTRE_WEBHOOK_URL: fake.url,
      SPECTRE_DISPATCH_TRANSPORT: 'webhook',
      ...extraEnv,
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
  fake = await startFakeSpectre({ port: 4300 + Math.floor(Math.random() * 200), token: 'change-me', autoReview: true });
  await startBaton();

  const spectre = (await request('/api/agents/spectre')).json;
  assert.equal(spectre.id, 'spectre', 'Spectre agent exists');
  assert.equal(spectre.dispatch_enabled, true, 'Spectre dispatch enabled');

  const command = (await request('/api/flow/command', { method: 'POST', body: { input: 'delegate Spectre review MetaTravelers launch plan' } })).json;
  assert.equal(command.interpreted_as, 'delegate_spectre', 'Spectre command parsed');

  const flow = (await request('/api/flow')).json;
  const spectreTouches = flow.next_touches.filter(t => t.task_id === command.created.task_id);
  assert.equal(spectreTouches.length, 1, 'one clean Spectre assignment touch');
  const touch = spectreTouches[0];
  assert.equal(touch.agent_id, 'spectre', 'touch assigned to Spectre');

  const assigned = (await request(`/api/touches/${touch.id}/action`, { method: 'PATCH', body: { action: 'assign' } })).json;
  if (assigned.dispatch_status !== 'accepted') console.error('dispatch response', JSON.stringify(assigned, null, 2));
  assert.equal(assigned.dispatch_status, 'accepted', 'dispatch accepted');
  assert.equal(assigned.run.status, 'running', 'run running after ACK');
  assert.equal(assigned.run.agent_id, 'spectre', 'run linked to Spectre');
  const forbidden = await request(`/api/runs/${assigned.run.id}/status`, { method: 'POST', body: { status: 'running', message: 'unauthorized status' }, ok: false });
  assert.equal(forbidden.res.status, 403, 'callback token required');
  const authorized = await request(`/api/runs/${assigned.run.id}/status`, { method: 'POST', body: { status: 'running', message: 'authorized status' }, headers: { Authorization: 'Bearer callback-token' } });
  assert.equal(authorized.json.status, 'running', 'authorized status callback accepted');
  assert.equal(fake.received.length, 1, 'fake Spectre received envelope');
  assert.equal(fake.received[0].schema, 'baton.dispatch.v1', 'dispatch envelope schema');
  assert.ok(!JSON.stringify(fake.received[0]).includes('change-me'), 'dispatch payload does not include token');

  const reviewReady = await waitFor(async () => {
    const run = (await request(`/api/runs/${assigned.run.id}`)).json;
    return run.status === 'review_ready' ? run : null;
  }, 'review_ready run');
  assert.equal(reviewReady.review_packet_id && true, true, 'run linked to review packet');

  const reviewFlow = (await request('/api/flow')).json;
  const reviewTouch = reviewFlow.next_touches.find(t => t.review_packet_id === reviewReady.review_packet_id);
  assert.ok(reviewTouch, 'review touch created');

  const accepted = (await request(`/api/touches/${reviewTouch.id}/action`, { method: 'PATCH', body: { action: 'accept' } })).json;
  assert.equal(accepted.task.status, 'done', 'accept marks task done');
  const completed = (await request(`/api/runs/${assigned.run.id}`)).json;
  assert.equal(completed.status, 'completed', 'accept completes run');
  const spectreAfter = (await request('/api/agents/spectre')).json;
  assert.equal(spectreAfter.status, 'idle', 'Spectre released to idle');

  await failurePath();
  console.log(`smoke-dispatch-spectre ok against ${BASE}`);
}

async function failurePath() {
  const command = (await request('/api/flow/command', { method: 'POST', body: { input: 'delegate Spectre review unavailable webhook path' } })).json;
  const flow = (await request('/api/flow')).json;
  const touch = flow.next_touches.find(t => t.task_id === command.created.task_id);
  assert.ok(touch, 'failure test touch exists');
  const oldUrl = fake.url;
  fake.url = 'http://127.0.0.1:9/baton/dispatch';
  await request('/api/agents/spectre', { method: 'PATCH', body: { dispatch_target: 'http://127.0.0.1:9/baton/dispatch', dispatch_config: { transport: 'webhook', token_env: 'SPECTRE_DISPATCH_TOKEN', timeout_ms: 500 } } });
  const failed = (await request(`/api/touches/${touch.id}/action`, { method: 'PATCH', body: { action: 'assign' } })).json;
  assert.equal(failed.dispatch_status, 'failed', 'closed webhook marks dispatch failed');
  assert.equal(failed.run.status, 'failed', 'run failed on closed webhook');
  assert.equal(failed.task.status, 'ready', 'task remains ready on failure');
  const agent = (await request('/api/agents/spectre')).json;
  assert.notEqual(agent.status, 'running', 'Spectre not running after failed dispatch');
  fake.url = oldUrl;
}

async function cleanup() {
  if (baton) baton.kill('SIGTERM');
  if (fake?.server) fake.server.close();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
}).finally(cleanup);
