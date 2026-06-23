#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_INBOX = path.join(ROOT, 'local', 'nectar-dispatch-inbox');
const DEFAULT_MAX_BODY_BYTES = 64 * 1024;
const MAX_BODY_BYTES = positiveIntEnv('NECTAR_BRIDGE_MAX_BODY_BYTES', DEFAULT_MAX_BODY_BYTES);

function positiveIntEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    console.warn(`[nectar-bridge] ignoring invalid ${name}=${raw}; using ${fallback}`);
    return fallback;
  }
  return value;
}

function startNectarDispatchBridge({
  port = Number(process.env.NECTAR_BRIDGE_PORT || 4310),
  token = process.env.NECTAR_DISPATCH_TOKEN || '',
  inboxDir = process.env.NECTAR_DISPATCH_INBOX || DEFAULT_INBOX,
  host = process.env.NECTAR_BRIDGE_HOST || '127.0.0.1',
} = {}) {
  const received = [];
  const rejected = [];
  const startedAt = new Date();
  fs.mkdirSync(inboxDir, { recursive: true });

  const reject = (res, status, errors, extra = {}) => {
    const reason = Array.isArray(errors) ? errors.join('; ') : String(errors);
    const errorList = Array.isArray(errors) ? errors : [String(errors)];
    rejected.push({ rejected_at: new Date().toISOString(), status, reason, errors: errorList });
    return json(res, status, { ok: false, status: 'rejected', errors: errorList, ...extra });
  };

  const server = http.createServer(async (req, res) => {
    if ((req.method === 'GET' || req.method === 'HEAD') && req.url === '/health') {
      const lastReceived = received.length ? received[received.length - 1] : null;
      const lastRejected = rejected.length ? rejected[rejected.length - 1] : null;
      const inboxRecordCount = countInboxRecords(inboxDir);
      const lastInboxPath = lastReceived ? path.relative(ROOT, lastReceived.file).split(path.sep).join('/') : null;
      const body = {
        ok: true,
        service: 'nectar-dispatch-bridge',
        bind_host: host,
        dispatch_path: '/baton/dispatch',
        token_required: Boolean(token),
        started_at: startedAt.toISOString(),
        uptime_seconds: Math.floor((Date.now() - startedAt.getTime()) / 1000),
        received_count: received.length,
        rejected_count: rejected.length,
        inbox_record_count: inboxRecordCount,
        inbox_writable: isInboxWritable(inboxDir),
        last_received_at: lastReceived ? lastReceived.received_at : null,
        last_received_dispatch_id: lastReceived ? lastReceived.envelope.dispatch_id : null,
        last_received_run_id: lastReceived ? lastReceived.envelope.run_id : null,
        last_inbox_path: lastInboxPath,
        last_rejected_at: lastRejected ? lastRejected.rejected_at : null,
        last_rejection_status: lastRejected ? lastRejected.status : null,
        last_rejection_reason: lastRejected ? lastRejected.reason : null,
        last_rejection_errors: lastRejected ? lastRejected.errors : null,
        max_body_bytes: MAX_BODY_BYTES,
      };
      return req.method === 'HEAD' ? headJson(res, 200) : json(res, 200, body);
    }
    if (req.method !== 'POST' || req.url !== '/baton/dispatch') {
      return json(res, 404, { ok: false, error: 'not found' });
    }
    if (token && req.headers.authorization !== `Bearer ${token}`) {
      return reject(res, 401, ['bad token']);
    }
    if (!isJsonRequest(req)) {
      req.resume();
      return reject(res, 415, ['content-type must be application/json']);
    }

    const contentLength = Number(req.headers['content-length'] || 0);
    if (contentLength > MAX_BODY_BYTES) {
      req.resume();
      return reject(res, 413, ['body too large']);
    }

    const body = await readJson(req);
    if (body && body.__body_too_large) {
      return reject(res, 413, ['body too large']);
    }
    if (body && body.__invalid_json) {
      return reject(res, 400, ['invalid json']);
    }
    const errors = validateEnvelope(body);
    if (errors.length) return reject(res, 400, errors);

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
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return ['body must be a JSON object'];
  }
  for (const key of ['schema', 'dispatch_id', 'run_id', 'task_id', 'touch_id', 'agent_id', 'callbacks']) {
    if (!body[key]) errors.push(`missing ${key}`);
  }
  if (body.schema !== 'baton.dispatch.v1') errors.push('bad schema');
  if (body.agent_id && body.agent_id !== 'nectar') errors.push('agent_id must be nectar');
  errors.push(...validateCallbackUrls(body.callbacks));
  if (JSON.stringify(body).length > 25000) errors.push('envelope too large');
  return errors;
}

function validateCallbackUrls(callbacks = {}) {
  const errors = [];
  for (const key of ['ack_url', 'status_url', 'review_packet_url']) {
    const value = callbacks[key];
    if (!value) continue;
    try {
      const parsed = new URL(value);
      if (!['http:', 'https:'].includes(parsed.protocol)) errors.push(`${key} must be http(s)`);
      if (parsed.username || parsed.password) errors.push(`${key} must not include credentials`);
    } catch (_) {
      errors.push(`${key} must be a valid URL`);
    }
  }
  return errors;
}

function toOpenClawPrompt(envelope) {
  const callbacks = envelope.callbacks || {};
  const callbackLines = Object.entries({
    ack_url: callbacks.ack_url,
    status_url: callbacks.status_url,
    review_packet_url: callbacks.review_packet_url,
  })
    .filter(([, value]) => value)
    .map(([key, value]) => `- ${key}: ${value}`);
  const lines = [
    'BATON dispatch received for Nectar.',
    '',
    `Dispatch: ${envelope.dispatch_id}`,
    `Run: ${envelope.run_id}`,
    `Task: ${envelope.task_id}`,
    `Touch: ${envelope.touch_id}`,
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
    'Callbacks:',
    ...(callbackLines.length ? callbackLines : ['- none provided']),
    '',
    'Local safety:',
    '- Treat this as a private local handoff; do not publish the envelope, callback URLs, tokens, or private task context.',
    '- Use configured local Nectar/OpenClaw tools for any follow-up, and only call callbacks after the corresponding work is actually done.',
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

function isJsonRequest(req) {
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  return contentType.split(';').map(part => part.trim()).includes('application/json');
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function headJson(res, status) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end();
}

function safeName(value) {
  return String(value || 'unknown').replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 80);
}

function countInboxRecords(inboxDir) {
  try {
    return fs.readdirSync(inboxDir).filter(file => file.endsWith('.json')).length;
  } catch (_) {
    return 0;
  }
}

function isInboxWritable(inboxDir) {
  try {
    fs.accessSync(inboxDir, fs.constants.W_OK);
    return true;
  } catch (_) {
    return false;
  }
}

if (require.main === module) {
  startNectarDispatchBridge().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { MAX_BODY_BYTES, countInboxRecords, isInboxWritable, isJsonRequest, positiveIntEnv, startNectarDispatchBridge, toOpenClawPrompt, validateCallbackUrls, validateEnvelope };
