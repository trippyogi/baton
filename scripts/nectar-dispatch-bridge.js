#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_INBOX = path.join(ROOT, 'local', 'nectar-dispatch-inbox');
const MAX_BODY_BYTES = Number(process.env.NECTAR_BRIDGE_MAX_BODY_BYTES || 64 * 1024);

function startNectarDispatchBridge({
  port = Number(process.env.NECTAR_BRIDGE_PORT || 4310),
  token = process.env.NECTAR_DISPATCH_TOKEN || '',
  inboxDir = process.env.NECTAR_DISPATCH_INBOX || DEFAULT_INBOX,
  host = process.env.NECTAR_BRIDGE_HOST || '127.0.0.1',
} = {}) {
  const received = [];
  fs.mkdirSync(inboxDir, { recursive: true });

  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      const lastReceived = received.length ? received[received.length - 1] : null;
      return json(res, 200, {
        ok: true,
        service: 'nectar-dispatch-bridge',
        received_count: received.length,
        last_received_at: lastReceived ? lastReceived.received_at : null,
        max_body_bytes: MAX_BODY_BYTES,
      });
    }
    if (req.method !== 'POST' || req.url !== '/baton/dispatch') {
      return json(res, 404, { ok: false, error: 'not found' });
    }
    if (token && req.headers.authorization !== `Bearer ${token}`) {
      return json(res, 401, { ok: false, status: 'rejected', message: 'bad token' });
    }

    const body = await readJson(req);
    if (body && body.__body_too_large) {
      return json(res, 413, { ok: false, status: 'rejected', errors: ['body too large'] });
    }
    if (body && body.__invalid_json) {
      return json(res, 400, { ok: false, status: 'rejected', errors: ['invalid json'] });
    }
    const errors = validateEnvelope(body);
    if (errors.length) return json(res, 400, { ok: false, status: 'rejected', errors });

    const record = {
      received_at: new Date().toISOString(),
      envelope: body,
      prompt: toOpenClawPrompt(body),
    };
    const file = path.join(inboxDir, `${safeName(body.run_id)}-${safeName(body.dispatch_id)}.json`);
    fs.writeFileSync(file, JSON.stringify(record, null, 2));
    received.push({ file, envelope: body, received_at: record.received_at });

    return json(res, 200, {
      ok: true,
      status: 'accepted',
      external_run_id: `nectar_bridge_${body.run_id}`,
      inbox_path: path.relative(ROOT, file).split(path.sep).join('/'),
      message: 'Nectar bridge accepted dispatch for local inbox processing.',
    });
  });

  return new Promise(resolve => {
    server.listen(port, host, () => {
      const url = `http://${host}:${port}/baton/dispatch`;
      console.log(`[nectar-bridge] listening at ${url}`);
      console.log(`[nectar-bridge] inbox ${inboxDir}`);
      resolve({ server, received, url, inboxDir });
    });
  });
}

function validateEnvelope(body) {
  const errors = [];
  for (const key of ['schema', 'dispatch_id', 'run_id', 'task_id', 'touch_id', 'agent_id', 'callbacks']) {
    if (!body[key]) errors.push(`missing ${key}`);
  }
  if (body.schema !== 'baton.dispatch.v1') errors.push('bad schema');
  if (body.agent_id && body.agent_id !== 'nectar') errors.push('agent_id must be nectar');
  if (JSON.stringify(body).length > 25000) errors.push('envelope too large');
  return errors;
}

function toOpenClawPrompt(envelope) {
  const lines = [
    'BATON dispatch received for Nectar.',
    '',
    `Run: ${envelope.run_id}`,
    `Task: ${envelope.task_id}`,
    `Title: ${envelope.title || 'BATON dispatch'}`,
    `Priority: ${envelope.priority || 'medium'}`,
    `Intent: ${envelope.intent || 'orchestrate'}`,
    '',
    'Objective:',
    envelope.objective || envelope.context?.summary || '',
    '',
    'Instructions:',
    ...(Array.isArray(envelope.instructions) ? envelope.instructions.map(item => `- ${item}`) : []),
    '',
    'Expected output: produce a concise review packet summary and recommended next action. Do not claim external actions unless actually completed.',
  ];
  return lines.join('\n').trim();
}

function readJson(req) {
  return new Promise(resolve => {
    let data = '';
    let tooLarge = false;
    req.on('data', chunk => {
      if (tooLarge) return;
      data += chunk;
      if (Buffer.byteLength(data, 'utf8') > MAX_BODY_BYTES) {
        tooLarge = true;
        data = '';
      }
    });
    req.on('end', () => {
      if (tooLarge) return resolve({ __body_too_large: true });
      try { resolve(JSON.parse(data || '{}')); }
      catch (_) { resolve({ __invalid_json: true }); }
    });
    req.on('close', () => {
      if (tooLarge) resolve({ __body_too_large: true });
    });
  });
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function safeName(value) {
  return String(value || 'unknown').replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 80);
}

if (require.main === module) {
  startNectarDispatchBridge().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { MAX_BODY_BYTES, startNectarDispatchBridge, toOpenClawPrompt, validateEnvelope };
