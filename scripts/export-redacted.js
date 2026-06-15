#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const opts = { format: 'json', output: null, includeRuns: false, includeAgents: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--format') opts.format = argv[++i] || '';
    else if (arg.startsWith('--format=')) opts.format = arg.slice('--format='.length);
    else if (arg === '--output') opts.output = argv[++i] || '';
    else if (arg.startsWith('--output=')) opts.output = arg.slice('--output='.length);
    else if (arg === '--include-runs') opts.includeRuns = true;
    else if (arg === '--include-agents') opts.includeAgents = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!['json', 'markdown'].includes(opts.format)) throw new Error('format must be json or markdown');
  if (!opts.output) {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
    opts.output = path.join(ROOT, 'exports', `redacted-${stamp}.${opts.format === 'json' ? 'json' : 'md'}`);
  } else {
    opts.output = path.resolve(ROOT, opts.output);
  }
  return opts;
}

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value || '');
    return parsed == null ? fallback : parsed;
  } catch (_) {
    return fallback;
  }
}

function redactedId(prefix, index) {
  return `${prefix}_${String(index + 1).padStart(3, '0')}`;
}

function redactText(value, label) {
  const length = typeof value === 'string' ? value.length : 0;
  return `[redacted-${label} length=${length}]`;
}

function redactTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags.map(() => '[redacted-tag]');
}

function day(value) {
  return value ? String(value).slice(0, 10) : null;
}

function redactTask(row, index) {
  return {
    id: redactedId('task', index),
    title: '[redacted-title]',
    description: redactText(row.description, 'description'),
    status: row.status,
    priority: row.priority,
    owner: row.owner ? '[redacted-owner]' : null,
    tags: redactTags(parseJson(row.tags, [])),
    due_at_day: day(row.due_at),
    domain: row.domain || 'product',
    project_key: row.project_key ? '[redacted-project-key]' : null,
    context_key: row.context_key ? '[redacted-context-key]' : null,
    impact_score: row.impact_score,
    effort_score: row.effort_score,
    autonomy_level: row.autonomy_level,
    risk_level: row.risk_level,
    human_touch_minutes: row.human_touch_minutes,
    agent_hours_unlocked: row.agent_hours_unlocked,
    created_day: day(row.created_at),
    updated_day: day(row.updated_at),
  };
}

function redactTouch(row, index) {
  return {
    id: redactedId('touch', index),
    task_id: row.task_id ? '[redacted-task-id]' : null,
    run_id: row.run_id ? '[redacted-run-id]' : null,
    agent_id: row.agent_id ? '[redacted-agent-id]' : null,
    title: '[redacted-title]',
    description: redactText(row.description, 'description'),
    type: row.type,
    status: row.status,
    primary_action: row.primary_action,
    secondary_actions: parseJson(row.secondary_actions, []),
    why_now: redactText(row.why_now, 'why-now'),
    domain: row.domain,
    mode_fit: row.mode_fit,
    portfolio_weight: row.portfolio_weight,
    impact_score: row.impact_score,
    effort_score: row.effort_score,
    urgency_score: row.urgency_score,
    confidence_score: row.confidence_score,
    quality_score: row.quality_score,
    risk_score: row.risk_score,
    score: row.score,
    rank: row.rank,
    source: row.source,
    created_day: day(row.created_at),
    updated_day: day(row.updated_at),
  };
}

function redactAgent(row, index) {
  return {
    id: redactedId('agent', index),
    name: '[redacted-agent-name]',
    type: row.type,
    status: row.status,
    skills: redactTags(parseJson(row.skills, [])),
    permissions: '[redacted-permissions]',
    current_task_id: row.current_task_id ? '[redacted-task-id]' : null,
    current_run_id: row.current_run_id ? '[redacted-run-id]' : null,
    cost_profile: '[redacted-cost-profile]',
    dispatch_enabled: Boolean(row.dispatch_enabled),
    dispatch_transport: row.dispatch_transport,
    dispatch_target: row.dispatch_target ? '[redacted-dispatch-target]' : null,
    dispatch_config: '[redacted-dispatch-config]',
    quality_score: row.quality_score,
    reliability_score: row.reliability_score,
    last_activity_day: day(row.last_activity_at),
  };
}

function redactRun(row, index) {
  return {
    id: redactedId('run', index),
    agent_name: row.agent_name ? '[redacted-agent-name]' : null,
    worker_type: row.worker_type,
    status: row.status,
    task_id: row.task_id ? '[redacted-task-id]' : null,
    touch_id: row.touch_id ? '[redacted-touch-id]' : null,
    agent_id: row.agent_id ? '[redacted-agent-id]' : null,
    dispatch_status: row.dispatch_status,
    dispatch_transport: row.dispatch_transport,
    dispatch_target: row.dispatch_target ? '[redacted-dispatch-target]' : null,
    dispatch_payload: '[redacted-dispatch-payload]',
    external_run_id: row.external_run_id ? '[redacted-external-run-id]' : null,
    error: row.error ? '[redacted-error]' : null,
    cost: row.cost,
    tokens: row.tokens,
    created_day: day(row.created_at),
    started_day: day(row.started_at),
    ended_day: day(row.ended_at),
  };
}

function secretFindings(content) {
  const patterns = [
    ['openai-style secret key', /sk-[A-Za-z0-9_-]{20,}/],
    ['GitHub token', /(ghp_|github_pat_)[A-Za-z0-9_]{20,}/],
    ['Slack token', /xox[baprs]-[A-Za-z0-9-]{20,}/],
    ['private key block', /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/],
    ['AWS access key', /AKIA[0-9A-Z]{16}/],
    ['bearer token', /Bearer [A-Za-z0-9._-]{20,}/],
  ];
  return patterns.filter(([, regex]) => regex.test(content)).map(([name]) => name);
}

function toMarkdown(exported) {
  const lines = ['# BATON redacted export', '', `Generated: ${exported.generated_at}`, '', '## Counts', ''];
  for (const [key, value] of Object.entries(exported.counts)) lines.push(`- ${key}: ${value}`);
  lines.push('', '## Tasks', '');
  for (const task of exported.tasks) lines.push(`- ${task.id}: ${task.status} / ${task.priority} / ${task.domain} / ${task.risk_level}`);
  lines.push('', '## Touches', '');
  for (const touch of exported.touches) lines.push(`- ${touch.id}: ${touch.type} / ${touch.status} / rank ${touch.rank ?? 'n/a'}`);
  if (exported.agents) {
    lines.push('', '## Agents', '');
    for (const agent of exported.agents) lines.push(`- ${agent.id}: ${agent.type} / ${agent.status} / dispatch ${agent.dispatch_enabled ? 'enabled' : 'disabled'}`);
  }
  if (exported.runs) {
    lines.push('', '## Runs', '');
    for (const run of exported.runs) lines.push(`- ${run.id}: ${run.status} / ${run.dispatch_status}`);
  }
  lines.push('');
  return lines.join('\n');
}

function main() {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const db = require('../server/db');
    const tasks = db.prepare('SELECT * FROM tasks ORDER BY created_at ASC').all();
    const touches = db.prepare('SELECT * FROM baton_touches ORDER BY COALESCE(rank, 9999), created_at ASC').all();
    const agents = opts.includeAgents ? db.prepare('SELECT * FROM agents ORDER BY name ASC').all() : [];
    const runs = opts.includeRuns ? db.prepare('SELECT * FROM runs ORDER BY created_at ASC').all() : [];
    const exported = {
      schema_version: 'baton.redacted_export.v1',
      generated_at: new Date().toISOString(),
      source: 'local-sqlite',
      redaction: {
        titles: 'redacted',
        descriptions: 'redacted',
        owners: 'redacted',
        dispatch_targets: 'redacted',
        dispatch_configs: 'redacted',
      },
      counts: { tasks: tasks.length, touches: touches.length, agents: agents.length, runs: runs.length },
      tasks: tasks.map(redactTask),
      touches: touches.map(redactTouch),
    };
    if (opts.includeAgents) exported.agents = agents.map(redactAgent);
    if (opts.includeRuns) exported.runs = runs.map(redactRun);

    const content = opts.format === 'json' ? `${JSON.stringify(exported, null, 2)}\n` : toMarkdown(exported);
    const findings = secretFindings(content);
    if (findings.length) throw new Error(`redacted export still contains secret-looking content: ${findings.join(', ')}`);
    fs.mkdirSync(path.dirname(opts.output), { recursive: true });
    fs.writeFileSync(opts.output, content);
    console.log(`BATON redacted export written: ${path.relative(ROOT, opts.output)}`);
    console.log(`tasks: ${tasks.length}, touches: ${touches.length}, agents: ${agents.length}, runs: ${runs.length}`);
  } catch (err) {
    console.error(`export-redacted failed: ${err.message}`);
    process.exit(1);
  }
}

main();
