#!/usr/bin/env node
'use strict';

const http = require('http');

function startFakeSpectre({ port = Number(process.env.FAKE_SPECTRE_PORT || 4300), token = process.env.SPECTRE_DISPATCH_TOKEN || '', autoReview = process.env.FAKE_SPECTRE_AUTO_REVIEW !== 'false' } = {}) {
  const received = [];
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/baton/dispatch') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    if (token && req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, status: 'rejected', message: 'bad token' }));
      return;
    }
    const body = await readJson(req);
    const errors = validateEnvelope(body);
    if (errors.length) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, status: 'rejected', errors }));
      return;
    }
    received.push(body);
    const externalRunId = `spectre_fake_${Date.now()}`;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, external_run_id: externalRunId, status: 'accepted' }));

    if (autoReview) {
      setTimeout(() => submitReviewPacket(body).catch(err => console.error('[fake-spectre] review callback failed:', err.message)), 250);
    }
  });

  return new Promise(resolve => {
    server.listen(port, '127.0.0.1', () => {
      console.log(`[fake-spectre] listening at http://127.0.0.1:${port}/baton/dispatch`);
      resolve({ server, received, url: `http://127.0.0.1:${port}/baton/dispatch` });
    });
  });
}

function readJson(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); }
      catch (_) { resolve({}); }
    });
  });
}

function validateEnvelope(body) {
  const errors = [];
  for (const key of ['schema', 'dispatch_id', 'run_id', 'task_id', 'touch_id', 'agent_id', 'callbacks']) {
    if (!body[key]) errors.push(`missing ${key}`);
  }
  if (body.schema !== 'baton.dispatch.v1') errors.push('bad schema');
  return errors;
}

async function submitReviewPacket(envelope) {
  const url = envelope.callbacks?.review_packet_url;
  if (!url) return;
  const packet = {
    schema: 'baton.review_packet.v1',
    run_id: envelope.run_id,
    task_id: envelope.task_id,
    agent_id: envelope.agent_id,
    goal: envelope.objective || envelope.title,
    summary: 'Fake Spectre reviewed the dispatch and produced a local test packet.',
    recommended_next_action: 'Accept the fake Spectre result to complete the dispatch smoke test.',
    confidence_score: 0.82,
    quality_score: 0.8,
    sections: [{ type: 'bullets', title: 'Key findings', items: ['Envelope was valid.', 'Callbacks were reachable.', 'No external action was taken.'] }],
    evidence: ['fake-spectre local harness'],
    risks: ['This is a harness, not real Spectre work.'],
    open_questions: [],
    artifacts: [],
  };
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(packet) });
  if (!res.ok) throw new Error(`review packet ${res.status}: ${await res.text()}`);
}

if (require.main === module) {
  startFakeSpectre().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { startFakeSpectre };
