#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE = require(path.join(ROOT, 'package.json'));
const DEFAULT_INBOX = path.join(ROOT, 'local', 'nectar-dispatch-inbox');
const DEFAULT_MAX_BODY_BYTES = 64 * 1024;
const PENDING_INBOX_PREVIEW_LIMIT = 5;
const INBOX_RECORD_SCHEMA_VERSION = 'baton.nectar_bridge.inbox_record.v1';
const PROMPT_HASH_ALGORITHM = 'sha256';
const SAFETY_PROFILE = 'private_local_inbox_only';
const MAX_BODY_BYTES = positiveIntEnv('NECTAR_BRIDGE_MAX_BODY_BYTES', DEFAULT_MAX_BODY_BYTES);
const BRIDGE_INSTANCE_ID = `nectar_bridge_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

function bridgeRequestId() {
  return `nectar_req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

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

function bridgeConfigFromEnv(env = process.env) {
  return {
    port: Number(env.NECTAR_BRIDGE_PORT || 4310),
    token: env.NECTAR_DISPATCH_TOKEN || '',
    inboxDir: env.NECTAR_DISPATCH_INBOX || DEFAULT_INBOX,
    host: env.NECTAR_BRIDGE_HOST || '127.0.0.1',
    maxBodyBytes: MAX_BODY_BYTES,
  };
}

function validateBridgeConfig(config = bridgeConfigFromEnv()) {
  const errors = [];
  if (!Number.isSafeInteger(config.port) || config.port < 1 || config.port > 65535) {
    errors.push('NECTAR_BRIDGE_PORT must be an integer from 1 to 65535');
  }
  if (!config.host || typeof config.host !== 'string') {
    errors.push('NECTAR_BRIDGE_HOST must be non-empty');
  } else if (!isLoopbackHost(config.host) && !config.token) {
    errors.push('non-loopback Nectar bridge binds require NECTAR_DISPATCH_TOKEN');
  }
  if (!config.inboxDir || typeof config.inboxDir !== 'string') {
    errors.push('NECTAR_DISPATCH_INBOX must be a non-empty directory path');
  } else if (path.resolve(config.inboxDir) === path.parse(path.resolve(config.inboxDir)).root) {
    errors.push('NECTAR_DISPATCH_INBOX must not be a filesystem root');
  }
  if (!Number.isSafeInteger(config.maxBodyBytes) || config.maxBodyBytes < 1) {
    errors.push('NECTAR_BRIDGE_MAX_BODY_BYTES must be a positive integer');
  }
  return errors;
}

function checkBridgeEnvironment(config = bridgeConfigFromEnv()) {
  const errors = validateBridgeConfig(config);
  const inboxParent = path.dirname(path.resolve(config.inboxDir || DEFAULT_INBOX));
  const inboxParentExists = fs.existsSync(inboxParent);
  const inboxExists = fs.existsSync(config.inboxDir);
  const inboxWritable = inboxExists ? isInboxWritable(config.inboxDir) : inboxParentExists && isInboxWritable(inboxParent);
  if (!inboxParentExists) errors.push(`NECTAR_DISPATCH_INBOX parent does not exist: ${inboxParent}`);
  if (inboxParentExists && !inboxWritable) errors.push(`NECTAR_DISPATCH_INBOX parent is not writable: ${inboxParent}`);
  return {
    ok: errors.length === 0,
    schema_version: 'baton.nectar_bridge.check_env.v1',
    safety_profile: SAFETY_PROFILE,
    generated_at: new Date().toISOString(),
    bridge_version: PACKAGE.version,
    bridge_instance_id: BRIDGE_INSTANCE_ID,
    bind_host: config.host,
    port: config.port,
    dispatch_path: '/baton/dispatch',
    dispatch_url: `http://${config.host}:${config.port}/baton/dispatch`,
    token_required: Boolean(config.token),
    inbox_dir: path.relative(ROOT, config.inboxDir).split(path.sep).join('/') || '.',
    inbox_parent_exists: inboxParentExists,
    inbox_exists: inboxExists,
    inbox_writable: inboxWritable,
    max_body_bytes: config.maxBodyBytes,
    errors,
    operator_next_check: errors.length ? 'fix the reported bridge environment issue before starting the local bridge' : 'start the bridge when ready, then check GET /health before wiring BATON dispatch',
  };
}

function startNectarDispatchBridge(config = {}) {
  const resolvedConfig = { ...bridgeConfigFromEnv(), ...config };
  const { port, token, inboxDir, host } = resolvedConfig;
  const configErrors = validateBridgeConfig({ port, token, inboxDir, host, maxBodyBytes: MAX_BODY_BYTES });
  if (configErrors.length) {
    throw new Error(configErrors.join('; '));
  }
  const received = [];
  const rejected = [];
  const startedAt = new Date();
  fs.mkdirSync(inboxDir, { recursive: true });

  const reject = (res, status, errors, extra = {}) => {
    const generatedAt = new Date().toISOString();
    const requestId = bridgeRequestId();
    const reason = Array.isArray(errors) ? errors.join('; ') : String(errors);
    const errorList = Array.isArray(errors) ? errors : [String(errors)];
    const rejectionCode = rejectionCodeFor(status, errorList);
    rejected.push({ rejected_at: generatedAt, request_id: requestId, status, reason, errors: errorList, code: rejectionCode });
    return json(res, status, {
      ok: false,
      schema_version: 'baton.nectar_bridge.dispatch_result.v1',
      bridge_version: PACKAGE.version,
      bridge_instance_id: BRIDGE_INSTANCE_ID,
      bridge_request_id: requestId,
      safety_profile: SAFETY_PROFILE,
      generated_at: generatedAt,
      status: 'rejected',
      rejection_code: rejectionCode,
      error_count: errorList.length,
      errors: errorList,
      operator_next_check: nectarRejectionNextCheck(rejectionCode),
      ...extra,
    });
  };

  const server = http.createServer(async (req, res) => {
    if ((req.method === 'GET' || req.method === 'HEAD') && req.url === '/health') {
      const lastReceived = received.length ? received[received.length - 1] : null;
      const lastRejected = rejected.length ? rejected[rejected.length - 1] : null;
      const inboxRecordCount = countInboxRecords(inboxDir);
      const pendingInboxNames = pendingInboxRecordNames(inboxDir);
      const inboxProcessingStatusCounts = inboxRecordProcessingStatusCounts(inboxDir);
      const pendingInboxPaths = pendingInboxNames.map(name => path.posix.join(path.relative(ROOT, inboxDir).split(path.sep).join('/') || '.', name));
      const firstPendingInboxName = oldestPendingInboxRecordName(inboxDir);
      const newestPendingInboxName = newestPendingInboxRecordName(inboxDir);
      const oldestPendingInboxReceivedAt = firstPendingInboxName ? inboxRecordReceivedAt(inboxDir, firstPendingInboxName) : null;
      const newestPendingInboxReceivedAt = newestPendingInboxName ? inboxRecordReceivedAt(inboxDir, newestPendingInboxName) : null;
      const oldestPendingInboxAgeSeconds = secondsSinceIso(oldestPendingInboxReceivedAt);
      const newestPendingInboxAgeSeconds = secondsSinceIso(newestPendingInboxReceivedAt);
      const pendingInboxOldestAgeBucket = pendingAgeBucket(oldestPendingInboxAgeSeconds);
      const pendingInboxNewestAgeBucket = pendingAgeBucket(newestPendingInboxAgeSeconds);
      const lastInboxPath = lastReceived ? path.relative(ROOT, lastReceived.file).split(path.sep).join('/') : null;
      const lastInboxName = lastReceived ? path.basename(lastReceived.file) : null;
      const lastInboxProcessingStatus = lastInboxName ? inboxRecordProcessingStatus(inboxDir, lastInboxName) : null;
      const lastPromptSha256 = lastReceived ? lastReceived.prompt_sha256 : null;
      const healthInboxDir = path.relative(ROOT, inboxDir).split(path.sep).join('/') || '.';
      const firstPendingInboxPath = firstPendingInboxName ? path.posix.join(healthInboxDir, firstPendingInboxName) : null;
      const newestPendingInboxPath = newestPendingInboxName ? path.posix.join(healthInboxDir, newestPendingInboxName) : null;
      const body = {
        ok: true,
        service: 'nectar-dispatch-bridge',
        health_schema_version: 'baton.nectar_bridge.health.v1',
        bridge_version: PACKAGE.version,
        bridge_instance_id: BRIDGE_INSTANCE_ID,
        safety_profile: SAFETY_PROFILE,
        generated_at: new Date().toISOString(),
        bind_host: host,
        dispatch_path: '/baton/dispatch',
        dispatch_url: `http://${host}:${port}/baton/dispatch`,
        token_required: Boolean(token),
        bridge_status: nectarBridgeStatus({ received, rejected, inboxDir }),
        started_at: startedAt.toISOString(),
        uptime_seconds: Math.floor((Date.now() - startedAt.getTime()) / 1000),
        received_count: received.length,
        rejected_count: rejected.length,
        inbox_record_count: inboxRecordCount,
        pending_inbox_count: pendingInboxNames.length,
        inbox_processing_status_counts: inboxProcessingStatusCounts,
        pending_inbox_preview_limit: PENDING_INBOX_PREVIEW_LIMIT,
        pending_inbox_names: pendingInboxNames.slice(0, PENDING_INBOX_PREVIEW_LIMIT),
        pending_inbox_paths: pendingInboxPaths.slice(0, PENDING_INBOX_PREVIEW_LIMIT),
        pending_inbox_overflow_count: Math.max(0, pendingInboxNames.length - PENDING_INBOX_PREVIEW_LIMIT),
        pending_inbox_has_overflow: pendingInboxNames.length > PENDING_INBOX_PREVIEW_LIMIT,
        pending_inbox_needs_operator: pendingInboxNames.length > 0,
        pending_inbox_attention_required: pendingInboxNames.length > 0,
        first_pending_inbox_name: firstPendingInboxName,
        first_pending_inbox_path: firstPendingInboxPath,
        pending_inbox_next_name: firstPendingInboxName,
        pending_inbox_next_path: firstPendingInboxPath,
        pending_inbox_oldest_name: firstPendingInboxName,
        pending_inbox_oldest_path: firstPendingInboxPath,
        pending_inbox_oldest_received_at: oldestPendingInboxReceivedAt,
        pending_inbox_oldest_age_seconds: oldestPendingInboxAgeSeconds,
        pending_inbox_oldest_age_bucket: pendingInboxOldestAgeBucket,
        pending_inbox_newest_name: newestPendingInboxName,
        pending_inbox_newest_path: newestPendingInboxPath,
        pending_inbox_newest_received_at: newestPendingInboxReceivedAt,
        pending_inbox_newest_age_seconds: newestPendingInboxAgeSeconds,
        pending_inbox_newest_age_bucket: pendingInboxNewestAgeBucket,
        inbox_dir: healthInboxDir,
        inbox_record_schema_version: INBOX_RECORD_SCHEMA_VERSION,
        inbox_writable: isInboxWritable(inboxDir),
        last_received_at: lastReceived ? lastReceived.received_at : null,
        last_received_request_id: lastReceived ? lastReceived.request_id : null,
        last_received_dispatch_id: lastReceived ? lastReceived.envelope.dispatch_id : null,
        last_received_run_id: lastReceived ? lastReceived.envelope.run_id : null,
        last_received_task_id: lastReceived ? lastReceived.envelope.task_id : null,
        last_received_touch_id: lastReceived ? lastReceived.envelope.touch_id : null,
        last_inbox_path: lastInboxPath,
        last_inbox_name: lastInboxName,
        last_inbox_processing_status: lastInboxProcessingStatus,
        last_prompt_sha256: lastPromptSha256,
        last_rejected_at: lastRejected ? lastRejected.rejected_at : null,
        last_rejection_request_id: lastRejected ? lastRejected.request_id : null,
        last_rejection_status: lastRejected ? lastRejected.status : null,
        last_rejection_reason: lastRejected ? lastRejected.reason : null,
        last_rejection_code: lastRejected ? lastRejected.code : null,
        last_rejection_errors: lastRejected ? lastRejected.errors : null,
        last_rejection_error_count: lastRejected ? lastRejected.errors.length : 0,
        max_body_bytes: MAX_BODY_BYTES,
        operator_next_check: nectarBridgeNextCheck({ received, rejected, inboxDir }),
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

    const requestId = bridgeRequestId();
    const inboxRecordName = `${safeName(body.run_id)}-${safeName(body.dispatch_id)}.json`;
    const prompt = toOpenClawPrompt(body);
    const promptSha256 = sha256Hex(prompt);
    const record = {
      schema_version: INBOX_RECORD_SCHEMA_VERSION,
      inbox_record_name: inboxRecordName,
      received_at: new Date().toISOString(),
      bridge_instance_id: BRIDGE_INSTANCE_ID,
      bridge_request_id: requestId,
      safety_profile: SAFETY_PROFILE,
      processing_status: 'pending_local_operator',
      operator_next_check: 'hand prompt to local Nectar/OpenClaw, then update BATON callbacks only after real work completes',
      envelope: body,
      prompt_sha256: promptSha256,
      prompt_hash_algorithm: PROMPT_HASH_ALGORITHM,
      prompt,
    };
    const file = path.join(inboxDir, inboxRecordName);
    try {
      fs.writeFileSync(file, JSON.stringify(record, null, 2), { flag: 'wx' });
    } catch (err) {
      if (err && err.code === 'EEXIST') {
        return reject(res, 409, ['duplicate dispatch inbox record'], { inbox_record_name: inboxRecordName });
      }
      throw err;
    }
    received.push({ file, envelope: body, received_at: record.received_at, request_id: requestId, prompt_sha256: promptSha256 });
    const pendingInboxNames = pendingInboxRecordNames(inboxDir);
    const inboxProcessingStatusCounts = inboxRecordProcessingStatusCounts(inboxDir);
    const pendingInboxPaths = pendingInboxNames.map(name => path.relative(ROOT, path.join(inboxDir, name)).split(path.sep).join('/'));
    const firstPendingInboxName = oldestPendingInboxRecordName(inboxDir);
    const newestPendingInboxName = newestPendingInboxRecordName(inboxDir);
    const firstPendingInboxPath = firstPendingInboxName
      ? path.relative(ROOT, path.join(inboxDir, firstPendingInboxName)).split(path.sep).join('/')
      : null;
    const newestPendingInboxPath = newestPendingInboxName
      ? path.relative(ROOT, path.join(inboxDir, newestPendingInboxName)).split(path.sep).join('/')
      : null;

    return json(res, 200, {
      ok: true,
      schema_version: 'baton.nectar_bridge.dispatch_result.v1',
      bridge_version: PACKAGE.version,
      bridge_instance_id: BRIDGE_INSTANCE_ID,
      bridge_request_id: requestId,
      safety_profile: SAFETY_PROFILE,
      generated_at: record.received_at,
      status: 'accepted',
      dispatch_id: body.dispatch_id,
      run_id: body.run_id,
      task_id: body.task_id,
      touch_id: body.touch_id,
      external_run_id: `nectar_bridge_${body.run_id}`,
      inbox_path: path.relative(ROOT, file).split(path.sep).join('/'),
      inbox_record_name: inboxRecordName,
      inbox_record_schema_version: INBOX_RECORD_SCHEMA_VERSION,
      inbox_processing_status: record.processing_status,
      prompt_sha256: promptSha256,
      prompt_hash_algorithm: PROMPT_HASH_ALGORITHM,
      received_count: received.length,
      inbox_record_count: countInboxRecords(inboxDir),
      pending_inbox_count: pendingInboxNames.length,
      inbox_processing_status_counts: inboxProcessingStatusCounts,
      pending_inbox_preview_limit: PENDING_INBOX_PREVIEW_LIMIT,
      pending_inbox_names: pendingInboxNames.slice(0, PENDING_INBOX_PREVIEW_LIMIT),
      pending_inbox_paths: pendingInboxPaths.slice(0, PENDING_INBOX_PREVIEW_LIMIT),
      pending_inbox_overflow_count: Math.max(0, pendingInboxNames.length - PENDING_INBOX_PREVIEW_LIMIT),
      pending_inbox_has_overflow: pendingInboxNames.length > PENDING_INBOX_PREVIEW_LIMIT,
      pending_inbox_needs_operator: pendingInboxNames.length > 0,
      pending_inbox_attention_required: pendingInboxNames.length > 0,
      first_pending_inbox_name: firstPendingInboxName,
      first_pending_inbox_path: firstPendingInboxPath,
      pending_inbox_next_name: firstPendingInboxName,
      pending_inbox_next_path: firstPendingInboxPath,
      pending_inbox_oldest_name: firstPendingInboxName,
      pending_inbox_oldest_path: firstPendingInboxPath,
      pending_inbox_newest_name: newestPendingInboxName,
      pending_inbox_newest_path: newestPendingInboxPath,
      message: 'Nectar bridge accepted dispatch for local inbox processing.',
      operator_next_check: 'open the inbox record or hand the generated prompt to local Nectar/OpenClaw for processing',
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

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function rejectionCodeFor(status, errors) {
  if (status === 401) return 'bad_token';
  if (status === 413) return 'body_too_large';
  if (status === 415) return 'unsupported_content_type';
  if (status === 409) return 'duplicate_dispatch';
  if (errors.includes('invalid json')) return 'invalid_json';
  if (errors.includes('body must be a JSON object')) return 'invalid_body_type';
  if (errors.some(error => /^(ack_url|status_url|review_packet_url) /.test(String(error)))) return 'invalid_callback_url';
  if (errors.some(error => String(error).startsWith('missing '))) return 'missing_required_field';
  if (errors.includes('bad schema')) return 'bad_schema';
  return 'invalid_envelope';
}

function nectarBridgeStatus({ received, rejected, inboxDir }) {
  if (!isInboxWritable(inboxDir)) return 'blocked_inbox_unwritable';
  if (received.length) return 'ready_to_process';
  if (rejected.length) return 'needs_client_fix';
  return 'idle';
}

function nectarBridgeNextCheck({ received, rejected, inboxDir }) {
  if (!isInboxWritable(inboxDir)) {
    return 'fix NECTAR_DISPATCH_INBOX permissions before dispatching more work';
  }
  if (received.length) {
    return 'open last_inbox_path and hand the generated prompt to local Nectar/OpenClaw';
  }
  if (rejected.length) {
    return 'fix the last_rejection_errors in the dispatch client, then retry the handoff';
  }
  return 'send a BATON dispatch smoke request before wiring a real local agent';
}

function nectarRejectionNextCheck(rejectionCode) {
  switch (rejectionCode) {
    case 'bad_token':
      return 'check NECTAR_DISPATCH_TOKEN on both BATON and the local Nectar bridge before retrying';
    case 'duplicate_dispatch':
      return 'open the existing inbox_record_name instead of retrying the same dispatch';
    case 'unsupported_content_type':
    case 'invalid_json':
    case 'invalid_body_type':
      return 'fix the dispatch client request encoding before retrying the handoff';
    case 'body_too_large':
      return 'shrink the dispatch envelope or explicitly raise NECTAR_BRIDGE_MAX_BODY_BYTES for this local bridge';
    case 'invalid_callback_url':
      return 'fix callback URLs and keep credentials out of URL userinfo before retrying';
    case 'missing_required_field':
    case 'bad_schema':
    case 'invalid_envelope':
    default:
      return 'fix the reported envelope errors in the dispatch client, then retry the handoff';
  }
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

function isLoopbackHost(host) {
  return ['localhost', '127.0.0.1', '::1'].includes(String(host || '').trim().toLowerCase());
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function headJson(res, status) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end();
}

function safeName(value) {
  return String(value || 'unknown').replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 80);
}

function inboxRecordNames(inboxDir) {
  try {
    return fs.readdirSync(inboxDir).filter(file => file.endsWith('.json')).sort();
  } catch (_) {
    return [];
  }
}

function countInboxRecords(inboxDir) {
  return inboxRecordNames(inboxDir).length;
}

function inboxRecordReceivedAt(inboxDir, name) {
  try {
    const record = JSON.parse(fs.readFileSync(path.join(inboxDir, name), 'utf8'));
    return typeof record.received_at === 'string' ? record.received_at : null;
  } catch (_) {
    return null;
  }
}

function inboxRecordProcessingStatus(inboxDir, name) {
  try {
    const record = JSON.parse(fs.readFileSync(path.join(inboxDir, name), 'utf8'));
    return typeof record.processing_status === 'string' ? record.processing_status : null;
  } catch (_) {
    return null;
  }
}

function pendingInboxRecordNames(inboxDir) {
  return inboxRecordNames(inboxDir).filter(name => inboxRecordProcessingStatus(inboxDir, name) === 'pending_local_operator');
}

function inboxRecordProcessingStatusCounts(inboxDir) {
  const counts = {};
  for (const name of inboxRecordNames(inboxDir)) {
    const status = inboxRecordProcessingStatus(inboxDir, name) || 'unknown';
    counts[status] = (counts[status] || 0) + 1;
  }
  return counts;
}

function secondsSinceIso(value, now = Date.now()) {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor((now - parsed) / 1000));
}

function pendingAgeBucket(ageSeconds) {
  if (ageSeconds == null) return 'none';
  if (ageSeconds < 15 * 60) return 'fresh';
  if (ageSeconds < 60 * 60) return 'warm';
  if (ageSeconds < 24 * 60 * 60) return 'stale';
  return 'old';
}

function firstInboxRecordName(inboxDir) {
  return oldestInboxRecordName(inboxDir);
}

function oldestInboxRecordName(inboxDir) {
  const names = inboxRecordNames(inboxDir);
  let oldest = null;
  let oldestReceivedAt = '';
  for (const name of names) {
    const receivedAt = inboxRecordReceivedAt(inboxDir, name) || '';
    if (!oldest || receivedAt < oldestReceivedAt || (receivedAt === oldestReceivedAt && name < oldest)) {
      oldest = name;
      oldestReceivedAt = receivedAt;
    }
  }
  return oldest;
}

function newestInboxRecordName(inboxDir) {
  const names = inboxRecordNames(inboxDir);
  let newest = null;
  let newestReceivedAt = '';
  for (const name of names) {
    const receivedAt = inboxRecordReceivedAt(inboxDir, name) || '';
    if (!newest || receivedAt > newestReceivedAt || (receivedAt === newestReceivedAt && name > newest)) {
      newest = name;
      newestReceivedAt = receivedAt;
    }
  }
  return newest;
}

function oldestPendingInboxRecordName(inboxDir) {
  return oldestNamedInboxRecord(inboxDir, pendingInboxRecordNames(inboxDir));
}

function newestPendingInboxRecordName(inboxDir) {
  return newestNamedInboxRecord(inboxDir, pendingInboxRecordNames(inboxDir));
}

function oldestNamedInboxRecord(inboxDir, names) {
  let oldest = null;
  let oldestReceivedAt = '';
  for (const name of names) {
    const receivedAt = inboxRecordReceivedAt(inboxDir, name) || '';
    if (!oldest || receivedAt < oldestReceivedAt || (receivedAt === oldestReceivedAt && name < oldest)) {
      oldest = name;
      oldestReceivedAt = receivedAt;
    }
  }
  return oldest;
}

function newestNamedInboxRecord(inboxDir, names) {
  let newest = null;
  let newestReceivedAt = '';
  for (const name of names) {
    const receivedAt = inboxRecordReceivedAt(inboxDir, name) || '';
    if (!newest || receivedAt > newestReceivedAt || (receivedAt === newestReceivedAt && name > newest)) {
      newest = name;
      newestReceivedAt = receivedAt;
    }
  }
  return newest;
}

function isInboxWritable(inboxDir) {
  try {
    fs.accessSync(inboxDir, fs.constants.W_OK);
    return true;
  } catch (_) {
    return false;
  }
}

function usage() {
  return `Usage: node scripts/nectar-dispatch-bridge.js [--check-env]

Starts the local-only BATON -> Nectar dispatch bridge.

Options:
  --check-env                         Validate env/config and print JSON without starting a listener.

Environment:
  NECTAR_BRIDGE_HOST=127.0.0.1        Bind host; non-loopback binds require NECTAR_DISPATCH_TOKEN.
  NECTAR_BRIDGE_PORT=4310             Bridge HTTP port.
  NECTAR_DISPATCH_TOKEN=...           Optional Bearer token required for POST /baton/dispatch.
  NECTAR_DISPATCH_INBOX=local/...     Inbox directory for accepted dispatch records.
  NECTAR_BRIDGE_MAX_BODY_BYTES=65536  Positive integer body-size limit.

Routes:
  GET|HEAD /health                    Safe health/observability check.
  POST /baton/dispatch                Accept baton.dispatch.v1 envelopes for local inbox processing.
`;
}

if (require.main === module) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stdout.write(usage());
    process.exit(0);
  }
  if (process.argv.includes('--check-env')) {
    const result = checkBridgeEnvironment();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(result.ok ? 0 : 2);
  }
  startNectarDispatchBridge().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { INBOX_RECORD_SCHEMA_VERSION, MAX_BODY_BYTES, bridgeConfigFromEnv, checkBridgeEnvironment, countInboxRecords, firstInboxRecordName, inboxRecordNames, inboxRecordProcessingStatus, inboxRecordProcessingStatusCounts, inboxRecordReceivedAt, isInboxWritable, isJsonRequest, isLoopbackHost, oldestInboxRecordName, oldestPendingInboxRecordName, pendingInboxRecordNames, positiveIntEnv, rejectionCodeFor, secondsSinceIso, startNectarDispatchBridge, toOpenClawPrompt, usage, validateBridgeConfig, validateCallbackUrls, validateEnvelope };
