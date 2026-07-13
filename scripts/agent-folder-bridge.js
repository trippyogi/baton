#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const db = require('../server/db');
const { transitionRun } = require('../server/lib/runs/state-machine');
const { rebuildTouches } = require('../server/lib/flow/rebuild');
const { id, stringifyJson } = require('../server/lib/flow/utils');
const { bridgePaths, resolveAgentDir, safeSegment } = require('../server/lib/dispatch/transports/folder');

const args = new Set(process.argv.slice(2));

if (args.has('--help') || (!args.has('--setup') && !args.has('--sync'))) {
  console.log(`Usage:
  npm run agent:setup
  npm run agent:sync

Environment:
  BATON_AGENT_DIR  Folder bridge root. Defaults to local/agent-bridge.
`);
  process.exit(0);
}

if (args.has('--setup')) setup();
if (args.has('--sync')) sync();

function setup() {
  const root = resolveAgentDir();
  for (const rel of ['inbox', 'claimed', 'outbox', 'done', 'failed']) {
    fs.mkdirSync(path.join(root, rel), { recursive: true });
  }
  console.log('BATON folder bridge ready.');
  console.log(`Root:   ${rel(root)}`);
  console.log(`Inbox:  ${rel(path.join(root, 'inbox'))}`);
  console.log(`Outbox: ${rel(path.join(root, 'outbox'))}`);
  console.log('');
  console.log('Cron example:');
  console.log(`* * * * * cd ${ROOT} && npm run agent:sync`);
  console.log('');
  console.log('Agent contract: read inbox/<agent_id>/run_*.json, move claimed work to claimed/<agent_id>/, then write outbox/<agent_id>/run_<id>.result.json.');
}

function sync() {
  const root = resolveAgentDir();
  const outboxRoot = path.join(root, 'outbox');
  fs.mkdirSync(outboxRoot, { recursive: true });
  const results = listJson(outboxRoot);
  let processed = 0;
  let failed = 0;

  for (const resultPath of results) {
    try {
      const raw = fs.readFileSync(resultPath, 'utf8');
      const result = JSON.parse(raw);
      applyResult(result, resultPath);
      moveResult(resultPath, 'done');
      processed += 1;
    } catch (err) {
      failed += 1;
      moveResult(resultPath, 'failed', err.message);
    }
  }

  if (processed || failed) rebuildTouches(db);
  console.log(JSON.stringify({ ok: failed === 0, processed, failed, outbox: rel(outboxRoot) }, null, 2));
}

function applyResult(result, resultPath) {
  if (result.schema !== 'baton.agent_result.v1') throw new Error('schema must be baton.agent_result.v1');
  if (!result.run_id) throw new Error('run_id is required');
  const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(result.run_id);
  if (!run) throw new Error(`unknown run_id: ${result.run_id}`);
  const status = normalizeStatus(result.status);
  const payload = {
    source: 'folder_bridge',
    result_path: rel(resultPath),
    summary: String(result.summary || ''),
    next_action: String(result.next_action || ''),
  };

  if (status === 'running' || status === 'blocked') {
    transitionVia(run.id, status, 'agent_folder_status', payload);
    db.prepare(`UPDATE runs SET dispatch_status = ?, last_status_at = datetime('now') WHERE id = ?`).run(status, run.id);
    if (run.agent_id) db.prepare(`UPDATE agents SET status = ?, current_task_id = ?, current_run_id = ?, last_activity_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(status === 'blocked' ? 'blocked' : 'running', run.task_id, run.id, run.agent_id);
    return;
  }

  if (status === 'review_ready') {
    transitionVia(run.id, 'review_ready', 'agent_folder_result', payload);
    const packetId = createReviewPacket(run, result);
    db.prepare(`UPDATE runs SET dispatch_status = 'review_ready', review_packet_id = ?, last_status_at = datetime('now') WHERE id = ?`).run(packetId, run.id);
    if (run.task_id) db.prepare(`UPDATE tasks SET status = 'review', updated_at = datetime('now') WHERE id = ?`).run(run.task_id);
    if (run.touch_id) db.prepare(`UPDATE baton_touches SET status = 'passed', updated_at = datetime('now') WHERE id = ?`).run(run.touch_id);
    if (run.agent_id) db.prepare(`UPDATE agents SET status = 'reviewing', last_activity_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(run.agent_id);
    return;
  }

  if (status === 'completed') {
    transitionVia(run.id, 'completed', 'agent_folder_result', payload);
    db.prepare(`UPDATE runs SET dispatch_status = 'completed', last_status_at = datetime('now') WHERE id = ?`).run(run.id);
    if (run.task_id) db.prepare(`UPDATE tasks SET status = 'done', updated_at = datetime('now') WHERE id = ?`).run(run.task_id);
    if (run.touch_id) db.prepare(`UPDATE baton_touches SET status = 'resolved', resolved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(run.touch_id);
    releaseAgent(run);
    return;
  }

  if (status === 'failed') {
    transitionVia(run.id, 'failed', 'agent_folder_result', { ...payload, error: result.error || result.summary || 'Agent reported failure.' });
    db.prepare(`UPDATE runs SET dispatch_status = 'failed', error = ?, last_status_at = datetime('now') WHERE id = ?`).run(result.error || result.summary || 'Agent reported failure.', run.id);
    if (run.task_id) db.prepare(`UPDATE tasks SET status = 'ready', updated_at = datetime('now') WHERE id = ?`).run(run.task_id);
    if (run.touch_id) db.prepare(`UPDATE baton_touches SET status = 'active', updated_at = datetime('now') WHERE id = ?`).run(run.touch_id);
    releaseAgent(run);
  }
}

function transitionVia(runId, toStatus, event, payload) {
  const current = db.prepare('SELECT status FROM runs WHERE id = ?').get(runId)?.status;
  if (current === toStatus) {
    transitionRun({ db, runId, event, toStatus, actor: 'agent-folder', payload });
    return;
  }
  if (current === 'pending_dispatch' && ['review_ready', 'completed', 'failed', 'blocked'].includes(toStatus)) {
    transitionRun({ db, runId, event: 'agent_folder_claimed', toStatus: 'dispatched', actor: 'agent-folder', payload });
    transitionRun({ db, runId, event: 'agent_folder_running', toStatus: 'running', actor: 'agent-folder', payload });
  } else if (current === 'dispatched' && ['review_ready', 'completed', 'blocked'].includes(toStatus)) {
    transitionRun({ db, runId, event: 'agent_folder_running', toStatus: 'running', actor: 'agent-folder', payload });
  }
  const transitioned = transitionRun({ db, runId, event, toStatus, actor: 'agent-folder', payload });
  if (!transitioned.ok && transitioned.code !== 'terminal_state') throw new Error(transitioned.error || transitioned.code || 'Run transition failed.');
}

function createReviewPacket(run, result) {
  const existing = db.prepare('SELECT id FROM review_packets WHERE run_id = ? ORDER BY created_at DESC LIMIT 1').get(run.id);
  if (existing) return existing.id;
  const packetId = id('packet');
  const task = run.task_id ? db.prepare('SELECT title FROM tasks WHERE id = ?').get(run.task_id) : null;
  db.prepare(`
    INSERT INTO review_packets (
      id, task_id, run_id, agent_id, work_type, goal, artifact_url, summary, changes,
      rationale, evidence, risks, open_questions, suggested_next_action, schema_version,
      sections, artifacts, confidence_score, quality_score, packet_status, validator_notes,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'folder_agent_result', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'baton.review_packet.v1', ?, ?, ?, ?, 'valid', '', datetime('now'), datetime('now'))
  `).run(
    packetId,
    run.task_id || null,
    run.id,
    run.agent_id || null,
    task?.title || result.title || 'Folder agent result',
    firstArtifactUrl(result.artifacts),
    String(result.summary || 'Folder agent returned a result.'),
    String(result.changes || result.summary || ''),
    String(result.rationale || ''),
    stringifyJson(arrayOf(result.evidence, result.summary || 'Folder result received.')),
    stringifyJson(arrayOf(result.risks)),
    stringifyJson(arrayOf(result.open_questions)),
    String(result.next_action || 'Review folder agent result.'),
    stringifyJson(result.sections || [{ type: 'markdown', title: 'Summary', body: String(result.summary || '') }]),
    stringifyJson(result.artifacts || []),
    Number(result.confidence_score || 0.7),
    Number(result.quality_score || 0.7)
  );
  return packetId;
}

function releaseAgent(run) {
  if (!run.agent_id) return;
  db.prepare(`UPDATE agents SET status = 'idle', current_task_id = NULL, current_run_id = NULL, last_activity_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND (current_run_id IS NULL OR current_run_id = ?)`).run(run.agent_id, run.id);
}

function normalizeStatus(status) {
  const value = String(status || '').toLowerCase();
  if (['running', 'blocked', 'review_ready', 'completed', 'failed'].includes(value)) return value;
  throw new Error(`unsupported status: ${status}`);
}

function listJson(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJson(full));
    else if (entry.isFile() && entry.name.endsWith('.json')) out.push(full);
  }
  return out.sort();
}

function moveResult(source, state, error = null) {
  const parsed = path.parse(source);
  const agentId = safeSegment(path.basename(path.dirname(source)), 'unassigned');
  const targetDir = path.join(resolveAgentDir(), state, agentId);
  fs.mkdirSync(targetDir, { recursive: true });
  const target = path.join(targetDir, parsed.base);
  fs.renameSync(source, target);
  if (error) fs.writeFileSync(`${target}.error.txt`, `${error}\n`, { mode: 0o600 });
}

function arrayOf(value, fallback = null) {
  if (Array.isArray(value)) return value.map(String);
  if (value) return [String(value)];
  return fallback ? [String(fallback)] : [];
}

function firstArtifactUrl(artifacts) {
  if (!Array.isArray(artifacts)) return '';
  return artifacts.find(item => item && typeof item.url === 'string')?.url || '';
}

function rel(target) {
  return path.relative(ROOT, target).split(path.sep).join('/') || '.';
}
