'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const DEFAULT_AGENT_DIR = path.join(ROOT, 'local', 'agent-bridge');

function resolveAgentDir(config = {}, env = process.env) {
  const fromEnv = config.root_env ? env[config.root_env] : null;
  return path.resolve(fromEnv || config.root || env.BATON_AGENT_DIR || DEFAULT_AGENT_DIR);
}

function safeSegment(value, fallback = 'agent') {
  return String(value || fallback).replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 120) || fallback;
}

function bridgePaths(agentId, config = {}) {
  const root = resolveAgentDir(config);
  const safeAgentId = safeSegment(agentId, 'unassigned');
  return {
    root,
    agentId: safeAgentId,
    inboxDir: path.join(root, 'inbox', safeAgentId),
    claimedDir: path.join(root, 'claimed', safeAgentId),
    outboxDir: path.join(root, 'outbox', safeAgentId),
    doneDir: path.join(root, 'done', safeAgentId),
    failedDir: path.join(root, 'failed', safeAgentId),
  };
}

async function sendFolder({ envelope, agent, config = {} }) {
  const paths = bridgePaths(envelope.agent_id || agent?.id, config);
  fs.mkdirSync(paths.inboxDir, { recursive: true });
  fs.mkdirSync(paths.claimedDir, { recursive: true });
  fs.mkdirSync(paths.outboxDir, { recursive: true });
  fs.mkdirSync(paths.doneDir, { recursive: true });
  fs.mkdirSync(paths.failedDir, { recursive: true });

  const record = {
    schema: 'baton.agent_task.v1',
    status: 'queued',
    queued_at: new Date().toISOString(),
    agent_id: envelope.agent_id || agent?.id || null,
    run_id: envelope.run_id,
    touch_id: envelope.touch_id,
    task_id: envelope.task_id,
    title: envelope.title,
    objective: envelope.objective,
    instructions: envelope.instructions || [],
    envelope,
  };
  const name = `run_${safeSegment(envelope.run_id, 'unknown')}.json`;
  const target = path.join(paths.inboxDir, name);
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  fs.renameSync(tmp, target);

  return {
    ok: true,
    dispatch_status: 'queued_to_agent',
    ack: {
      schema: 'baton.agent_folder_ack.v1',
      status: 'queued_to_agent',
      run_id: envelope.run_id,
      task_id: envelope.task_id,
      touch_id: envelope.touch_id,
      agent_id: envelope.agent_id || agent?.id || null,
      inbox_path: path.relative(ROOT, target).split(path.sep).join('/'),
      outbox_dir: path.relative(ROOT, paths.outboxDir).split(path.sep).join('/'),
    },
  };
}

module.exports = { sendFolder, bridgePaths, resolveAgentDir, safeSegment };
