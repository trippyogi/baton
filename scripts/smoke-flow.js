#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');

const BASE = process.env.BATON_BASE_URL || process.env.BASE_URL || 'http://127.0.0.1:4200';
const stamp = Date.now();

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

async function main() {
  const flow = (await request('/api/flow')).json;
  assert.ok(flow.mode, 'flow mode exists');
  assert.ok(flow.airspace, 'flow airspace exists');
  assert.ok(Array.isArray(flow.next_touches), 'flow next_touches is array');

  const capture = (await request('/api/flow/command', {
    method: 'POST',
    body: { input: `capture xss <b>test</b> ${stamp}` },
  })).json;
  assert.ok(capture.created?.task_id, 'capture created task');
  assert.ok(capture.created?.touch_id, 'capture created touch');

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
      changes: 'Smoke changes.',
      rationale: 'Smoke rationale.',
      suggested_next_action: 'Review this packet.',
      evidence: ['smoke evidence'],
      risks: ['none'],
      open_questions: [],
      confidence_score: 0.8,
      quality_score: 0.85,
    },
  })).json;
  assert.equal(validPacket.valid, true, 'valid packet marked valid');
  assert.ok(validPacket.review_touch_id, 'valid packet creates review touch');

  const archived = (await request(`/api/tasks/${task.id}`, { method: 'DELETE' })).json;
  assert.equal(archived.archived, task.id, 'delete archives task');

  const runs = (await request('/api/runs?limit=5')).json;
  assert.ok(Array.isArray(runs.runs), 'runs list exists');
  assert.equal(typeof runs.total, 'number', 'runs total exists');

  console.log(`smoke-flow ok against ${BASE}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
