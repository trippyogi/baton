#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

let BASE = process.env.BATON_BASE_URL || process.env.BASE_URL || '';
const stamp = Date.now();
let child = null;
let tempDir = null;

async function request(path, { method = 'GET', body, ok = true } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) {}
  if (ok && !res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
  return { res, json, text };
}

async function waitForHealth(timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const health = await request('/api/health', { ok: false });
      if (health.res.ok && health.json?.ok) return;
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${BASE}/api/health`);
}

async function startServerIfNeeded() {
  if (BASE) return;
  const port = String(4800 + Math.floor(Math.random() * 1000));
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baton-smoke-'));
  const dbPath = path.join(tempDir, 'smoke.db');
  BASE = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['server/index.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      VMC_PORT: port,
      BATON_DB_PATH: dbPath,
      REDIS_URL: 'redis://127.0.0.1:0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', data => process.env.BATON_SMOKE_VERBOSE && process.stdout.write(data));
  child.stderr.on('data', data => process.env.BATON_SMOKE_VERBOSE && process.stderr.write(data));
  child.on('exit', code => {
    if (code && code !== 0 && process.env.BATON_SMOKE_VERBOSE) console.error(`smoke server exited ${code}`);
  });
  await waitForHealth();
}

async function cleanup() {
  if (child) {
    child.kill('SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 250));
    if (!child.killed) child.kill('SIGKILL');
  }
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
}

async function main() {
  await startServerIfNeeded();
  if (BASE) await waitForHealth();

  const health = (await request('/api/health')).json;
  assert.equal(health.ok, true, 'health ok');

  const flow = (await request('/api/flow')).json;
  assert.ok(flow.mode, 'flow mode exists');
  assert.ok(flow.airspace, 'flow airspace exists');
  assert.ok(Array.isArray(flow.next_touches), 'flow next_touches is array');
  assert.ok(flow.next_touches.length > 0, 'fresh startup generates next touches');

  const mode = (await request('/api/flow/mode', { method: 'PATCH', body: { mode: 'review' } })).json;
  assert.equal(mode.mode, 'review', 'mode changes');
  const flowAfterMode = (await request('/api/flow')).json;
  assert.equal(flowAfterMode.mode, 'review', 'flow reports changed mode');

  const queue = (await request('/api/queue')).json;
  assert.ok(Array.isArray(queue.streams), 'queue responds without Redis');
  const queueStatus = (await request('/api/queue/stream-status')).json;
  assert.ok(queueStatus.circuit && queueStatus.vector, 'queue stream-status responds without Redis');

  const capture = (await request('/api/flow/command', {
    method: 'POST',
    body: { input: `capture xss <b>test</b> ${stamp}` },
  })).json;
  assert.ok(capture.created?.task_id, 'capture created task');
  assert.ok(capture.created?.touch_id, 'capture created touch');
  const capturedTask = (await request(`/api/tasks/${capture.created.task_id}`)).json;
  assert.ok(capturedTask.title.includes('<b>test</b>'), 'HTML payload preserved as text in API');

  const delegate = (await request('/api/flow/command', {
    method: 'POST',
    body: { input: `delegate smoke task ${stamp}` },
  })).json;
  assert.ok(delegate.created?.task_id, 'delegate created task');
  assert.ok(delegate.created?.touch_id, 'delegate created touch');

  const invalidAccept = await request(`/api/touches/${delegate.created.touch_id}/action`, {
    method: 'PATCH',
    body: { action: 'accept' },
    ok: false,
  });
  assert.equal(invalidAccept.res.status, 400, 'non-review accept is rejected');

  const preparedDelegate = (await request(`/api/touches/${delegate.created.touch_id}/action`, {
    method: 'PATCH',
    body: { action: 'delegate' },
  })).json;
  assert.equal(preparedDelegate.dispatch_status, 'not_configured', 'delegate is prepared-only without dispatcher');
  assert.equal(preparedDelegate.task.status, 'ready', 'prepared delegate does not mark task airborne');

  const snooze = (await request(`/api/touches/${delegate.created.touch_id}/action`, {
    method: 'PATCH',
    body: { action: 'snooze', until: '2000-01-01 00:00:00' },
  })).json;
  assert.equal(snooze.touch.status, 'pending', 'expired snooze reactivates via rebuild/listing');

  const task = (await request('/api/tasks', {
    method: 'POST',
    body: { title: `smoke review packet ${stamp}`, status: 'in_progress', priority: 'high' },
  })).json;

  const invalidPacket = (await request('/api/review-packets', {
    method: 'POST',
    body: {
      task_id: task.id,
      goal: 'Smoke invalid packet',
      summary: '',
      suggested_next_action: 'Review',
      evidence: [],
      confidence_score: 0.7,
      quality_score: 0.8,
    },
  })).json;
  assert.equal(invalidPacket.valid, false, 'invalid packet marked invalid');
  assert.ok(invalidPacket.refine_touch_id, 'invalid packet creates refine touch');

  const validPacket = (await request('/api/review-packets', {
    method: 'POST',
    body: {
      task_id: task.id,
      goal: 'Smoke valid packet',
      summary: 'A valid packet summary.',
      what_changed: ['Smoke changes.'],
      why_this_approach: 'Smoke rationale.',
      recommended_next_action: 'Review this packet.',
      evidence: ['smoke evidence'],
      risks: ['none'],
      open_questions: [],
      confidence_score: 0.8,
      quality_score: 0.85,
    },
  })).json;
  assert.equal(validPacket.valid, true, 'valid packet marked valid');
  assert.ok(validPacket.review_touch_id, 'valid packet creates review touch');

  const accepted = (await request(`/api/touches/${validPacket.review_touch_id}/action`, {
    method: 'PATCH',
    body: { action: 'accept' },
  })).json;
  assert.equal(accepted.touch.status, 'resolved', 'review accept resolves touch');
  assert.equal(accepted.task.status, 'done', 'review accept marks task done');

  const archived = (await request(`/api/tasks/${task.id}`, { method: 'DELETE' })).json;
  assert.equal(archived.archived, task.id, 'delete archives task');

  const runs = (await request('/api/runs?limit=5')).json;
  assert.ok(Array.isArray(runs.runs), 'runs list exists');
  assert.equal(typeof runs.total, 'number', 'runs total exists');

  console.log(`smoke-flow ok against ${BASE}`);
}

main()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(cleanup);
