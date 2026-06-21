'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const repo = process.env.BATON_REPO || process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'baton-adversarial-'));
const port = 7300 + Math.floor(Math.random() * 200);
const fakePort = 7500 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${port}`;
const OPERATOR_TOKEN = 'operator-test-token';
const CALLBACK_TOKEN = 'callback-test-token';
const received = [];

const fake = http.createServer(async (req, res) => {
  let data = '';
  for await (const chunk of req) data += chunk;
  let body = {};
  try { body = JSON.parse(data); } catch {}
  received.push(body);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true, status: 'accepted', external_run_id: `ext_${received.length}` }));
});

function listen(server, selectedPort) {
  return new Promise(resolve => server.listen(selectedPort, '127.0.0.1', resolve));
}

async function req(p, { method = 'GET', body, headers = {}, operator = true } = {}) {
  const authHeaders = operator ? { authorization: `Bearer ${OPERATOR_TOKEN}` } : {};
  const response = await fetch(BASE + p, {
    method,
    headers: {
      ...authHeaders,
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: response.status, ok: response.ok, json, text };
}

async function waitForHealth() {
  for (let i = 0; i < 100; i += 1) {
    try {
      const result = await req('/api/health', { operator: false });
      if (result.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('BATON health check did not become ready');
}

function assertLoopIntegrity(out) {
  assert.equal(out.operator_auth.unauthorized_status, 401, 'operator routes require the operator token');
  assert.equal(out.operator_auth.authorized_ok, true, 'operator token can call operator routes');
  assert.equal(out.callback_auth.operator_token_status, 403, 'operator token cannot authenticate callback route');
  assert.equal(out.callback_auth.callback_token_status, 409, 'callback token reaches callback route without operator token and sees terminal run');
  assert.equal(out.duplicate_dispatch.first, out.duplicate_dispatch.second, 'duplicate assign returns the same run');
  assert.equal(out.duplicate_dispatch.webhooks, 1, 'duplicate assign sends one webhook');
  assert.equal(out.duplicate_dispatch.runs.length, 1, 'duplicate assign creates one active run');
  assert.equal(out.structured_packet.sections[0].type, 'bullets', 'structured section type round-trips');
  assert.deepEqual(out.structured_packet.sections[0].items, ['A'], 'structured section items round-trip');
  assert.equal(out.structured_packet.artifacts[0].name, 'a.md', 'structured artifact round-trips');
  assert.equal(out.evaluator.agent_id, 'spectre', 'Spectre is executable evaluator fallback');
  assert.equal(out.evaluator.dispatch_status, 'accepted', 'evaluator fallback dispatch is accepted');
  assert.equal(out.evaluator.payload.context.source_review_packet.id, out.evaluator.source_packet_id, 'evaluator envelope includes source packet');
  assert.match(out.evaluator.payload.context.validator_notes, /summary is required/, 'evaluator envelope includes validator notes');
  assert.equal(out.feedback.contains_feedback, true, 'human feedback appears in next dispatch envelope');
  assert.equal(out.airspace.delta, 0, 'manual task in_progress does not increment Airborne');
  assert.equal(out.late_ack.before, 'completed', 'run completed before late ACK');
  assert.equal(out.late_ack.after, 'completed', 'late ACK cannot regress completed run');
}

(async () => {
  await listen(fake, fakePort);
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: repo,
    env: {
      ...process.env,
      VMC_PORT: String(port),
      BATON_DB_PATH: path.join(temp, 'db.sqlite'),
      REDIS_URL: 'redis://127.0.0.1:0',
      SPECTRE_WEBHOOK_URL: `http://127.0.0.1:${fakePort}/baton/dispatch`,
      SPECTRE_DISPATCH_TOKEN: 'x',
      BATON_API_TOKEN: OPERATOR_TOKEN,
      BATON_CALLBACK_TOKEN: CALLBACK_TOKEN,
      BATON_PUBLIC_BASE_URL: BASE,
      NODE_NO_WARNINGS: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', data => { stderr += data; });

  try {
    await waitForHealth();
    const out = {};

    const unauthorized = await req('/api/flow', { operator: false });
    const authorized = await req('/api/flow');
    out.operator_auth = { unauthorized_status: unauthorized.status, authorized_ok: authorized.ok };

    const cmd = (await req('/api/flow/command', { method: 'POST', body: { input: 'delegate Spectre duplicate dispatch test' } })).json;
    let flow = (await req('/api/flow?limit=50')).json;
    const touch = flow.next_touches.find(t => t.task_id === cmd.created.task_id);
    const d1 = await req(`/api/touches/${touch.id}/action`, { method: 'PATCH', body: { action: 'assign' } });
    const d2 = await req(`/api/touches/${touch.id}/action`, { method: 'PATCH', body: { action: 'assign' } });
    const runs = (await req('/api/runs?limit=100')).json.runs.filter(r => r.touch_id === touch.id);
    out.duplicate_dispatch = {
      first: d1.json.run?.id,
      second: d2.json.run?.id,
      webhooks: received.filter(item => item.touch_id === touch.id).length,
      runs: runs.map(r => ({ id: r.id, status: r.status })),
    };

    const task = (await req('/api/tasks', { method: 'POST', body: { title: 'Structured packet test', status: 'in_progress', owner: 'spectre' } })).json;
    const packetResp = await req('/api/review-packets', {
      method: 'POST',
      body: {
        task_id: task.id,
        goal: 'Goal',
        summary: 'Summary',
        recommended_next_action: 'Review',
        evidence: ['e'],
        risks: [],
        open_questions: [],
        confidence_score: 0.8,
        quality_score: 0.8,
        sections: [{ type: 'bullets', title: 'Findings', items: ['A'] }],
        artifacts: [{ type: 'markdown', name: 'a.md', url: 'http://example.test/a' }],
      },
    });
    const packet = packetResp.json.packet;
    out.structured_packet = { sections: packet.sections, artifacts: packet.artifacts };

    const badTask = (await req('/api/tasks', { method: 'POST', body: { title: 'Evaluator source test', description: 'base task description', status: 'in_progress', owner: 'spectre' } })).json;
    const bad = (await req('/api/review-packets', { method: 'POST', body: { task_id: badTask.id, goal: 'Missing summary evaluator goal', summary: '', recommended_next_action: 'Fix it', evidence: [], confidence_score: 0.5, quality_score: 0.4 } })).json;
    flow = (await req('/api/flow?limit=100')).json;
    const refine = flow.next_touches.find(t => t.id === bad.refine_touch_id);
    const evalDispatch = await req(`/api/touches/${refine.id}/action`, { method: 'PATCH', body: { action: 'send_to_evaluator' } });
    out.evaluator = { agent_id: evalDispatch.json.run?.agent_id, dispatch_status: evalDispatch.json.dispatch_status, payload: evalDispatch.json.run?.dispatch_payload, source_packet_id: refine.review_packet_id };

    const waitTask = (await req('/api/tasks', { method: 'POST', body: { title: 'Feedback propagation test', description: 'initial description', status: 'waiting', owner: 'spectre' } })).json;
    flow = (await req('/api/flow?limit=100')).json;
    const blocker = flow.next_touches.find(t => t.task_id === waitTask.id && t.type === 'blocker');
    await req(`/api/touches/${blocker.id}/action`, { method: 'PATCH', body: { action: 'answer', feedback: 'USE THIS CRITICAL HUMAN ANSWER' } });
    await req('/api/agents/spectre', { method: 'PATCH', body: { status: 'idle', current_task_id: null, current_run_id: null } });
    flow = (await req('/api/flow?limit=100')).json;
    const next = flow.next_touches.find(t => t.task_id === waitTask.id);
    await req(`/api/touches/${next.id}/action`, { method: 'PATCH', body: { action: next.primary_action } });
    const fbEnvelope = received.filter(item => item.task_id === waitTask.id).at(-1);
    out.feedback = { next_type: next.type, envelope: fbEnvelope, contains_feedback: JSON.stringify(fbEnvelope || {}).includes('USE THIS CRITICAL HUMAN ANSWER') };

    const before = (await req('/api/flow')).json.airspace.running;
    await req('/api/tasks', { method: 'POST', body: { title: 'Manual fake airborne', status: 'in_progress' } });
    const after = (await req('/api/flow')).json.airspace.running;
    out.airspace = { before, after, delta: after - before };

    const rp = (await req('/api/review-packets', { method: 'POST', body: { run_id: d1.json.run.id, task_id: cmd.created.task_id, agent_id: 'spectre', goal: 'finish', summary: 'done', recommended_next_action: 'accept', evidence: ['done'], confidence_score: 0.9, quality_score: 0.9 } })).json;
    flow = (await req('/api/flow?limit=100')).json;
    const rt = flow.next_touches.find(t => t.review_packet_id === rp.packet.id);
    await req(`/api/touches/${rt.id}/action`, { method: 'PATCH', body: { action: 'accept' } });
    const completed = (await req(`/api/runs/${d1.json.run.id}`)).json.status;
    const operatorAck = await req(`/api/runs/${d1.json.run.id}/ack`, { method: 'POST', headers: { authorization: `Bearer ${OPERATOR_TOKEN}` }, body: { ok: true, status: 'accepted', external_run_id: 'operator-token' }, operator: false });
    const late = await req(`/api/runs/${d1.json.run.id}/ack`, { method: 'POST', headers: { authorization: `Bearer ${CALLBACK_TOKEN}` }, body: { ok: true, status: 'accepted', external_run_id: 'late' }, operator: false });
    out.callback_auth = { operator_token_status: operatorAck.status, callback_token_status: late.status };
    out.late_ack = { before: completed, after: late.json.status };

    assertLoopIntegrity(out);
    console.log(JSON.stringify(out, null, 2));
    console.log('adversarial loop integrity ok');
  } finally {
    child.kill('SIGTERM');
    fake.close();
    setTimeout(() => fs.rmSync(temp, { recursive: true, force: true }), 250);
    if (stderr.trim()) process.stderr.write(stderr);
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
