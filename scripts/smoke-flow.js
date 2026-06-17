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
let childOut = '';
let childErr = '';

function printChildLogs() {
  if (childOut) console.error(`Server stdout:\n${childOut}`);
  if (childErr) console.error(`Server stderr:\n${childErr}`);
}

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
  printChildLogs();
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
  child.stdout.on('data', data => {
    childOut += data.toString();
    if (process.env.BATON_SMOKE_VERBOSE) process.stdout.write(data);
  });
  child.stderr.on('data', data => {
    childErr += data.toString();
    if (process.env.BATON_SMOKE_VERBOSE) process.stderr.write(data);
  });
  child.on('exit', code => {
    if (code && code !== 0) {
      console.error(`smoke server exited ${code}`);
      printChildLogs();
    }
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

  const localAgent = (await request('/api/agents', {
    method: 'POST',
    body: {
      id: `smoke-local-agent-${stamp}`,
      name: 'Smoke Local Agent',
      type: 'research',
      skills: ['research', 'summary'],
      dispatch_enabled: true,
      dispatch_transport: 'webhook',
      dispatch_target: 'SMOKE_AGENT_WEBHOOK_URL',
      dispatch_config: { url_env: 'SMOKE_AGENT_WEBHOOK_URL', token_env: 'SMOKE_AGENT_TOKEN' },
    },
  })).json;
  assert.equal(localAgent.dispatch_enabled, true, 'agent create preserves dispatch enabled');
  assert.equal(localAgent.dispatch_config.url_env, 'SMOKE_AGENT_WEBHOOK_URL', 'agent create stores env dispatch config');
  const fetchedLocalAgent = (await request(`/api/agents/${localAgent.id}`)).json;
  assert.equal(fetchedLocalAgent.name, 'Smoke Local Agent', 'agent detail returns created local agent');
  const unsafeAgent = await request('/api/agents', {
    method: 'POST',
    body: {
      id: `unsafe-agent-${stamp}`,
      name: 'Unsafe Agent',
      dispatch_enabled: true,
      dispatch_transport: 'webhook',
      dispatch_target: 'https://hooks.example.com/raw-secret-target',
    },
    ok: false,
  });
  assert.equal(unsafeAgent.res.status, 400, 'agent create rejects non-local raw webhook targets');

  const strategyPacket = (await request('/api/strategy-packets', {
    method: 'POST',
    body: {
      goal: `smoke strategy endpoint ${stamp}`,
      items: [
        { title: `Smoke endpoint task A ${stamp}`, owner: 'ops-agent' },
        { title: `Smoke endpoint task B ${stamp}`, owner: 'strategy-agent' },
      ],
      created_by: 'smoke-test',
    },
  })).json;
  assert.ok(strategyPacket.packet?.id, 'strategy packet endpoint creates packet');
  assert.equal(strategyPacket.tasks.length, 2, 'strategy packet endpoint creates supplied tasks');
  const fetchedStrategyPacket = (await request(`/api/strategy-packets/${strategyPacket.packet.id}`)).json;
  assert.equal(fetchedStrategyPacket.tasks.length, 2, 'strategy packet detail returns tasks');

  const strategyCommand = (await request('/api/flow/command', {
    method: 'POST',
    body: { input: `strategy smoke command ${stamp}\n- Verify smoke command path ${stamp}` },
  })).json;
  assert.equal(strategyCommand.interpreted_as, 'strategy_packet', 'strategy command routes to packet creation');
  assert.ok(strategyCommand.created?.strategy_packet_id, 'strategy command creates packet id');
  assert.equal(strategyCommand.tasks.length, 1, 'strategy command creates bullet task');

  const formalSpecMarkdown = `# Crucible Formal Specification\n\n**Project:** Crucible\n**Target repository:** \`https://github.com/example/crucible.git\`\n**Spec version:** v0.1 Draft\n**Flagship v0 mission pack:** Public Internet Intel\n\n### 1.1 One-sentence definition\n\n**Crucible is a local-first durable mission runner.**\n\n## 29. Roadmap\n\n### v0.1 — Core daemon and mission loop\n\nDeliverables:\n\n- Rust workspace.\n- CLI.\n- Daemon.\n\nAcceptance:\n\n- Can run a fake mission with multiple steps.\n- Can crash/restart and resume.\n\n### v0.2 — Model router and local worker\n\nDeliverables:\n\n- OpenAI-compatible provider adapter.\n- GPU status via \`nvidia-smi\`.\n\nAcceptance:\n\n- Can route one step to frontier and another to local model.\n`;
  const parsedFormalSpec = (await request('/api/formal-specs/parse', {
    method: 'POST',
    body: { markdown: formalSpecMarkdown },
  })).json;
  assert.equal(parsedFormalSpec.spec.project, 'Crucible', 'formal spec parser extracts project');
  assert.equal(parsedFormalSpec.spec.roadmap[0].version, 'v0.1', 'formal spec parser extracts roadmap version');
  assert.equal(parsedFormalSpec.items.length, 3, 'formal spec parser creates deliverable tasks');
  const parsedFormalSpecAll = (await request('/api/formal-specs/parse', {
    method: 'POST',
    body: { markdown: formalSpecMarkdown, include_all_phases: true },
  })).json;
  assert.equal(parsedFormalSpecAll.items.length, 5, 'formal spec parser can include all roadmap phases');
  const parsedFormalSpecPhase = (await request('/api/formal-specs/parse', {
    method: 'POST',
    body: { markdown: formalSpecMarkdown, phase: 'v0.2' },
  })).json;
  assert.ok(parsedFormalSpecPhase.goal.includes('v0.2'), 'formal spec parser can select a roadmap phase');
  assert.equal(parsedFormalSpecPhase.items.length, 2, 'selected roadmap phase creates only phase tasks');

  const formalSpecPacket = (await request('/api/formal-specs', {
    method: 'POST',
    body: { markdown: formalSpecMarkdown, created_by: 'smoke-test' },
  })).json;
  assert.ok(formalSpecPacket.packet?.id, 'formal spec endpoint creates strategy packet');
  assert.ok(formalSpecPacket.formal_spec?.id, 'formal spec endpoint persists an intake record');
  assert.equal(formalSpecPacket.spec.target_repository, 'https://github.com/example/crucible.git', 'formal spec endpoint preserves target repo');
  assert.equal(formalSpecPacket.tasks.length, 3, 'formal spec endpoint creates roadmap tasks');
  const formalSpecRecord = (await request(`/api/formal-specs/${formalSpecPacket.formal_spec.id}`)).json;
  assert.equal(formalSpecRecord.packet_id, formalSpecPacket.packet.id, 'formal spec record links to strategy packet');
  assert.equal(formalSpecRecord.parsed.project, 'Crucible', 'formal spec record stores parsed metadata');
  const formalSpecList = (await request('/api/formal-specs')).json;
  assert.ok(formalSpecList.some(spec => spec.id === formalSpecPacket.formal_spec.id), 'formal specs list includes persisted record');

  const capture = (await request('/api/flow/command', {
    method: 'POST',
    body: { input: `capture xss <b>test</b> ${stamp}` },
  })).json;
  assert.ok(capture.created?.task_id, 'capture created task');
  assert.ok(capture.created?.touch_id, 'capture created touch');
  const capturedTask = (await request(`/api/tasks/${capture.created.task_id}`)).json;
  assert.ok(capturedTask.title.includes('<b>test</b>'), 'HTML payload preserved as text in API');

  const dispatchTask = (await request('/api/flow/command', {
    method: 'POST',
    body: { input: `delegate smoke dispatch prep ${stamp}` },
  })).json;
  assert.ok(dispatchTask.created?.task_id, 'dispatch prep delegate created task');
  assert.ok(dispatchTask.created?.touch_id, 'dispatch prep delegate created touch');

  const dispatchPrep = (await request(`/api/tasks/${dispatchTask.created.task_id}/dispatch/prepare`, {
    method: 'POST',
    body: { instructions: 'Smoke-test prepared dispatch envelope.' },
  })).json;
  assert.ok(dispatchPrep.run?.id, 'dispatch prepare creates run');
  assert.equal(dispatchPrep.reused, false, 'first dispatch prepare is not reused');
  assert.equal(dispatchPrep.run.dispatch_status, 'prepared', 'dispatch prepare status is prepared');
  assert.equal(dispatchPrep.run.status, 'pending_dispatch', 'dispatch prepare does not launch a run');
  assert.equal(dispatchPrep.envelope?.schema, 'baton.dispatch.v1', 'dispatch prepare returns envelope');

  const dispatchPrepAgain = (await request(`/api/tasks/${dispatchTask.created.task_id}/dispatch/prepare`, {
    method: 'POST',
    body: { instructions: 'Smoke-test prepared dispatch envelope.' },
  })).json;
  assert.equal(dispatchPrepAgain.reused, true, 'second dispatch prepare reuses existing run');
  assert.equal(dispatchPrepAgain.run.id, dispatchPrep.run.id, 'idempotent dispatch prepare keeps run id');

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
  assert.equal(preparedDelegate.dispatch_status, 'not_configured', 'delegate is not configured without dispatcher');
  assert.equal(preparedDelegate.touch.status, 'active', 'unconfigured delegate remains visible');
  assert.equal(preparedDelegate.task.status, 'ready', 'unconfigured delegate does not mark task airborne');
  const afterPrepare = (await request('/api/flow?limit=50')).json;
  assert.ok(afterPrepare.next_touches.some(t => t.id === delegate.created.touch_id), 'unconfigured touch stays in next touches');

  const freshForSnooze = (await request('/api/flow')).json;
  const snoozeTarget = freshForSnooze.next_touches.find(t => (
    t.id !== delegate.created.touch_id && ['active', 'pending'].includes(t.status)
  ));
  assert.ok(snoozeTarget?.id, 'active or pending touch available for snooze test');
  const snooze = (await request(`/api/touches/${snoozeTarget.id}/action`, {
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
