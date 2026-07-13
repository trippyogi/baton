#!/usr/bin/env node
'use strict';

process.env.BATON_SKIP_DEFAULT_SEED = '1';

const db = require('../server/db');
const { rebuildTouches } = require('../server/lib/flow/rebuild');

const cleanOnly = process.argv.includes('--clean');

function isoHoursAgo(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function isoHoursFromNow(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function json(value) {
  return JSON.stringify(value);
}

function cleanDemo() {
  const before = counts();
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM touch_events WHERE touch_id IN (
      SELECT id FROM baton_touches
      WHERE id LIKE 'demo-%' OR task_id LIKE 'demo-%' OR run_id LIKE 'demo-%' OR agent_id LIKE 'demo-%'
    )`).run();
    db.prepare(`DELETE FROM baton_touches WHERE id LIKE 'demo-%' OR task_id LIKE 'demo-%' OR run_id LIKE 'demo-%' OR agent_id LIKE 'demo-%'`).run();
    db.prepare(`DELETE FROM run_events WHERE run_id LIKE 'demo-%'`).run();
    db.prepare(`DELETE FROM review_packets WHERE id LIKE 'demo-%' OR task_id LIKE 'demo-%' OR run_id LIKE 'demo-%' OR agent_id LIKE 'demo-%'`).run();
    db.prepare(`DELETE FROM runs WHERE id LIKE 'demo-%' OR task_id LIKE 'demo-%' OR agent_id LIKE 'demo-%'`).run();
    db.prepare(`DELETE FROM tasks WHERE id LIKE 'demo-%'`).run();
    db.prepare(`DELETE FROM agents WHERE id LIKE 'demo-%'`).run();
    db.prepare(`DELETE FROM app_metadata WHERE key = 'demo_data' AND value = 'seed-demo'`).run();
  });
  tx();
  const after = counts();
  return { before, after };
}

function counts() {
  const get = (table, where = `id LIKE 'demo-%'`) => db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get().n;
  return {
    agents: get('agents'),
    tasks: get('tasks'),
    runs: get('runs'),
    review_packets: get('review_packets'),
    touches: get('baton_touches', `id LIKE 'demo-%' OR task_id LIKE 'demo-%' OR run_id LIKE 'demo-%' OR agent_id LIKE 'demo-%'`),
  };
}

function seedAgents() {
  const stmt = db.prepare(`
    INSERT INTO agents (
      id, name, type, status, skills, permissions, current_task_id, current_run_id,
      dispatch_enabled, dispatch_transport, dispatch_target, dispatch_config,
      quality_score, reliability_score, last_activity_at, created_at, updated_at
    ) VALUES (
      @id, @name, @type, @status, @skills, @permissions, @current_task_id, @current_run_id,
      @dispatch_enabled, @dispatch_transport, @dispatch_target, @dispatch_config,
      @quality_score, @reliability_score, @last_activity_at, @created_at, @updated_at
    )
  `);

  const agents = [
    {
      id: 'demo-agent-growth-webhook',
      name: 'Demo Growth Agent',
      type: 'growth',
      status: 'running',
      skills: ['growth', 'content', 'revenue', 'campaign'],
      permissions: { external_messages: { draft_only: true }, production_changes: false },
      current_task_id: 'demo-task-growth-offer-review',
      current_run_id: 'demo-run-growth-running',
      dispatch_enabled: 1,
      dispatch_transport: 'webhook',
      dispatch_target: 'DEMO_GROWTH_WEBHOOK_URL',
      dispatch_config: { transport: 'webhook', url_env: 'DEMO_GROWTH_WEBHOOK_URL', token_env: 'DEMO_GROWTH_DISPATCH_TOKEN', timeout_ms: 10000 },
      quality_score: 0.82,
      reliability_score: 0.78,
      last_activity_at: isoHoursAgo(0.25),
    },
    {
      id: 'demo-agent-ops-idle',
      name: 'Demo Ops Agent',
      type: 'ops',
      status: 'idle',
      skills: ['ops', 'infra', 'maintenance', 'api'],
      permissions: { production_changes: false, external_messages: { draft_only: true } },
      current_task_id: null,
      current_run_id: null,
      dispatch_enabled: 1,
      dispatch_transport: 'webhook',
      dispatch_target: 'DEMO_OPS_WEBHOOK_URL',
      dispatch_config: { transport: 'webhook', url_env: 'DEMO_OPS_WEBHOOK_URL', token_env: 'DEMO_OPS_DISPATCH_TOKEN', timeout_ms: 10000 },
      quality_score: 0.76,
      reliability_score: 0.86,
      last_activity_at: isoHoursAgo(3),
    },
    {
      id: 'demo-agent-content-manual',
      name: 'Demo Content Agent',
      type: 'content',
      status: 'idle',
      skills: ['content', 'copy', 'brand', 'email'],
      permissions: { external_messages: { draft_only: true }, production_changes: false },
      current_task_id: null,
      current_run_id: null,
      dispatch_enabled: 0,
      dispatch_transport: 'manual',
      dispatch_target: null,
      dispatch_config: { transport: 'manual' },
      quality_score: 0.73,
      reliability_score: 0.69,
      last_activity_at: isoHoursAgo(12),
    },
    {
      id: 'demo-agent-evaluator-manual',
      name: 'Demo Evaluator Agent',
      type: 'evaluator',
      status: 'idle',
      skills: ['review', 'quality', 'evaluator', 'risk'],
      permissions: { production_changes: false },
      current_task_id: null,
      current_run_id: null,
      dispatch_enabled: 0,
      dispatch_transport: 'manual',
      dispatch_target: null,
      dispatch_config: { transport: 'manual' },
      quality_score: 0.88,
      reliability_score: 0.74,
      last_activity_at: isoHoursAgo(20),
    },
  ];

  for (const agent of agents) {
    stmt.run({
      ...agent,
      skills: json(agent.skills),
      permissions: json(agent.permissions),
      dispatch_config: json(agent.dispatch_config),
      created_at: isoHoursAgo(48),
      updated_at: isoHoursAgo(0.2),
    });
  }
  return agents.length;
}

function seedTasks() {
  const stmt = db.prepare(`
    INSERT INTO tasks (
      id, title, description, status, priority, owner, tags, due_at, linked_run_ids,
      impact_score, effort_score, created_at, updated_at, domain, project_key, context_key,
      autonomy_level, risk_level, quality_gate, spec_quality, human_touch_minutes,
      agent_hours_unlocked, confidence_score, quality_score, fun_score, strategic_optionality
    ) VALUES (
      @id, @title, @description, @status, @priority, @owner, @tags, @due_at, @linked_run_ids,
      @impact_score, @effort_score, @created_at, @updated_at, @domain, @project_key, @context_key,
      @autonomy_level, @risk_level, @quality_gate, @spec_quality, @human_touch_minutes,
      @agent_hours_unlocked, @confidence_score, @quality_score, @fun_score, @strategic_optionality
    )
  `);

  const tasks = [
    task('demo-task-growth-offer-review', 'Review launch offer copy', 'Demo Co needs a human pass on final launch offer copy before scheduling.', 'review', 'high', 'demo-agent-growth-webhook', ['growth', 'content'], 18, 9, 3, 'revenue', 1, 1.5, 0.86, 0.82, isoHoursAgo(5), isoHoursAgo(1), ['demo-run-growth-review-ready']),
    task('demo-task-ops-cache-tuning', 'Tune checkout cache headers', 'Checkout pages are ready for an ops agent to inspect cache headers and suggest safe defaults.', 'ready', 'high', 'demo-agent-ops-idle', ['infra', 'ops'], 30, 8, 4, 'code', 2, 2.5, 0.74, 0.76, isoHoursAgo(10), isoHoursAgo(2)),
    task('demo-task-inbox-ugc-idea', 'Process creator UGC idea', 'Customer support forwarded a creator idea that needs triage before it becomes a content task.', 'inbox', 'medium', 'operator', ['content', 'growth'], null, 6, 3, 'content', 1, 0.5, 0.64, 0.62, isoHoursAgo(7), isoHoursAgo(7)),
    task('demo-task-shipping-blocker', 'Answer shipping policy blocker', 'Agent needs a decision on whether free shipping applies to subscription bundles.', 'waiting', 'critical', 'operator', ['ops', 'growth'], 6, 8, 2, 'revenue', 1, 2, 0.8, 0.7, isoHoursAgo(9), isoHoursAgo(9)),
    task('demo-task-stale-pdp-run', 'Refresh product detail page QA', 'An agent started a PDP QA pass but has not posted a status recently.', 'in_progress', 'high', 'demo-agent-content-manual', ['content', 'ops'], 10, 7, 5, 'content', 2, 1.25, 0.68, 0.58, isoHoursAgo(36), isoHoursAgo(8), ['demo-run-content-stale']),
    task('demo-task-invalid-review', 'Evaluate malformed pricing analysis', 'A pricing analysis arrived without evidence and should be routed to evaluator/refinement.', 'review', 'medium', 'demo-agent-evaluator-manual', ['growth', 'ops'], null, 7, 3, 'revenue', 2, 1, 0.5, 0.35, isoHoursAgo(8), isoHoursAgo(2), ['demo-run-invalid-review']),
    task('demo-task-failed-attribution', 'Recover failed attribution export', 'Nightly attribution export failed and needs an operator decision on retry scope.', 'blocked', 'high', 'demo-agent-ops-idle', ['infra', 'ops'], 12, 8, 5, 'maintenance', 1, 1.75, 0.66, 0.6, isoHoursAgo(18), isoHoursAgo(4), ['demo-run-attribution-failed']),
    task('demo-task-email-draft', 'Draft abandoned-cart email variant', 'Ready copy task for a manual content agent.', 'ready', 'medium', 'demo-agent-content-manual', ['content', 'growth'], 48, 6, 3, 'content', 1, 1.5, 0.7, 0.72, isoHoursAgo(12), isoHoursAgo(3)),
    task('demo-task-inbox-partner', 'Triage wholesale partner request', 'New partner request needs routing and a next action.', 'inbox', 'medium', 'operator', ['ops', 'growth'], null, 5, 2, 'revenue', 1, 0.5, 0.62, 0.6, isoHoursAgo(3), isoHoursAgo(3)),
    task('demo-task-running-market-scan', 'Monitor competitor promo scan', 'Demo Growth Agent is actively running a competitor promo scan.', 'in_progress', 'medium', 'demo-agent-growth-webhook', ['growth'], null, 6, 4, 'revenue', 2, 1.25, 0.76, 0.73, isoHoursAgo(2), isoHoursAgo(0.25), ['demo-run-growth-running']),
    task('demo-task-done-vendor-cleanup', 'Archive old vendor intake sheet', 'Completed cleanup task included for realistic history.', 'done', 'low', 'demo-agent-ops-idle', ['ops'], null, 3, 2, 'admin', 1, 0.25, 0.8, 0.8, isoHoursAgo(36), isoHoursAgo(14), ['demo-run-vendor-completed']),
    task('demo-task-ready-infra-doc', 'Document webhook retry policy', 'Follow-up documentation is intentionally blocked until the cache-header decision is made.', 'blocked', 'medium', 'demo-agent-ops-idle', ['infra', 'ops'], null, 6, 4, 'maintenance', 1, 1.5, 0.7, 0.68, isoHoursAgo(5), isoHoursAgo(2)),
  ];

  for (const row of tasks) stmt.run(row);
  return tasks.length;
}

function task(id, title, description, status, priority, owner, tags, dueHours, impact, effort, domain, humanMinutes, agentHours, confidence, quality, createdAt, updatedAt, runs = []) {
  return {
    id,
    title,
    description,
    status,
    priority,
    owner,
    tags: json(tags),
    due_at: dueHours == null ? null : isoHoursFromNow(dueHours),
    linked_run_ids: json(runs),
    impact_score: impact,
    effort_score: effort,
    created_at: createdAt,
    updated_at: updatedAt,
    domain,
    project_key: 'demo-co-launch',
    context_key: 'demo-co',
    autonomy_level: 2,
    risk_level: impact >= 8 ? 'medium' : 'low',
    quality_gate: 'demo',
    spec_quality: quality < 0.5 ? 'weak' : 'clear',
    human_touch_minutes: humanMinutes,
    agent_hours_unlocked: agentHours,
    confidence_score: confidence,
    quality_score: quality,
    fun_score: 0.2,
    strategic_optionality: impact >= 8 ? 0.5 : 0.25,
  };
}

function seedRuns() {
  const stmt = db.prepare(`
    INSERT INTO runs (
      id, agent_name, worker_type, status, task_id, touch_id, agent_id, dispatch_status,
      dispatch_transport, dispatch_target, dispatch_payload, external_run_id, acknowledged_at,
      last_status_at, review_packet_id, error, idempotency_key, state_version, steps, logs,
      cost, tokens, started_at, ended_at, created_at
    ) VALUES (
      @id, @agent_name, @worker_type, @status, @task_id, NULL, @agent_id, @dispatch_status,
      @dispatch_transport, @dispatch_target, @dispatch_payload, @external_run_id, @acknowledged_at,
      @last_status_at, @review_packet_id, @error, @idempotency_key, 0, @steps, @logs,
      @cost, @tokens, @started_at, @ended_at, @created_at
    )
  `);
  const runs = [
    run('demo-run-growth-running', 'Demo Growth Agent', 'agent', 'running', 'demo-task-running-market-scan', 'demo-agent-growth-webhook', 'accepted', 'webhook', 'DEMO_GROWTH_WEBHOOK_URL', null, null, isoHoursAgo(0.25), null, null, isoHoursAgo(1), null, ['ACKed dispatch', 'Scanning competitor promos'], ['Recent status: collecting promo screenshots'], 0.18, 4200),
    run('demo-run-growth-review-ready', 'Demo Growth Agent', 'agent', 'review_ready', 'demo-task-growth-offer-review', 'demo-agent-growth-webhook', 'accepted', 'webhook', 'DEMO_GROWTH_WEBHOOK_URL', 'demo-packet-valid-offer', null, isoHoursAgo(1), 'demo-packet-valid-offer', null, isoHoursAgo(6), null, ['Drafted offer copy', 'Submitted review packet'], ['Review packet ready'], 0.42, 9800),
    run('demo-run-content-stale', 'Demo Content Agent', 'agent', 'running', 'demo-task-stale-pdp-run', 'demo-agent-content-manual', 'not_configured', 'manual', null, null, null, isoHoursAgo(9), null, null, isoHoursAgo(12), null, ['Started PDP QA'], ['No status since initial pass'], 0.05, 1200),
    run('demo-run-attribution-failed', 'Demo Ops Agent', 'agent', 'failed', 'demo-task-failed-attribution', 'demo-agent-ops-idle', 'failed', 'webhook', 'DEMO_OPS_WEBHOOK_URL', null, null, isoHoursAgo(4), null, 'CSV export timed out after retry budget was exhausted.', isoHoursAgo(5), isoHoursAgo(4), ['Started export', 'Retry budget exhausted'], ['Error: upstream report timed out'], 0.22, 6100),
    run('demo-run-vendor-completed', 'Demo Ops Agent', 'agent', 'completed', 'demo-task-done-vendor-cleanup', 'demo-agent-ops-idle', 'accepted', 'webhook', 'DEMO_OPS_WEBHOOK_URL', null, null, isoHoursAgo(14), null, null, isoHoursAgo(20), isoHoursAgo(14), ['Cleaned vendor sheet'], ['Completed'], 0.08, 1500),
    run('demo-run-invalid-review', 'Demo Evaluator Agent', 'agent', 'review_ready', 'demo-task-invalid-review', 'demo-agent-evaluator-manual', 'not_configured', 'manual', null, 'demo-packet-invalid-pricing', null, isoHoursAgo(2), 'demo-packet-invalid-pricing', null, isoHoursAgo(4), null, ['Submitted incomplete pricing analysis'], ['Missing evidence'], 0.11, 2800),
  ];
  for (const row of runs) stmt.run(row);
  return runs.length;
}

function run(id, agentName, workerType, status, taskId, agentId, dispatchStatus, transport, target, packetId, externalRunId, lastStatusAt, reviewPacketId, error, startedAt, endedAt, steps, logs, cost, tokens) {
  return {
    id,
    agent_name: agentName,
    worker_type: workerType,
    status,
    task_id: taskId,
    agent_id: agentId,
    dispatch_status: dispatchStatus,
    dispatch_transport: transport,
    dispatch_target: target,
    dispatch_payload: json({ schema: 'baton.dispatch.v1', demo: true, run_id: id, task_id: taskId, agent_id: agentId }),
    external_run_id: externalRunId,
    acknowledged_at: ['running', 'review_ready', 'completed'].includes(status) ? startedAt : null,
    last_status_at: lastStatusAt,
    review_packet_id: reviewPacketId,
    error,
    idempotency_key: `demo-${id}`,
    steps: json(steps),
    logs: json(logs),
    cost,
    tokens,
    started_at: startedAt,
    ended_at: endedAt,
    created_at: startedAt || isoHoursAgo(8),
  };
}

function seedReviewPackets() {
  const stmt = db.prepare(`
    INSERT INTO review_packets (
      id, task_id, run_id, agent_id, work_type, goal, artifact_url, summary, changes,
      rationale, evidence, risks, open_questions, suggested_next_action, schema_version,
      sections, artifacts, confidence_score, quality_score, packet_status, validator_notes,
      created_at, updated_at
    ) VALUES (
      @id, @task_id, @run_id, @agent_id, @work_type, @goal, @artifact_url, @summary, @changes,
      @rationale, @evidence, @risks, @open_questions, @suggested_next_action, @schema_version,
      @sections, @artifacts, @confidence_score, @quality_score, @packet_status, @validator_notes,
      @created_at, @updated_at
    )
  `);

  const packets = [
    {
      id: 'demo-packet-valid-offer',
      task_id: 'demo-task-growth-offer-review',
      run_id: 'demo-run-growth-review-ready',
      agent_id: 'demo-agent-growth-webhook',
      work_type: 'copy_review',
      goal: 'Prepare launch offer copy for human review.',
      artifact_url: 'https://example.com/demo/launch-offer',
      summary: 'Launch offer copy is ready with three variants and a recommended default.',
      changes: 'Drafted hero copy, email subject, and SMS variant for Demo Co launch.',
      rationale: 'Default variant balances urgency with brand trust and avoids over-discounting.',
      evidence: json(['Compared against prior campaign tone', 'Checked discount math', 'Included fallback copy']),
      risks: json(['Offer could over-index on discount seekers', 'SMS copy may need legal review']),
      open_questions: json(['Should free shipping stack with the launch code?']),
      suggested_next_action: 'Human should approve variant B or request one focused revision.',
      schema_version: 'baton.review_packet.v1',
      sections: json([{ type: 'markdown', title: 'Recommendation', body: 'Approve variant B for launch.' }]),
      artifacts: json([{ type: 'url', name: 'Launch offer draft', url: 'https://example.com/demo/launch-offer' }]),
      confidence_score: 0.86,
      quality_score: 0.84,
      packet_status: 'valid',
      validator_notes: '',
      created_at: isoHoursAgo(1),
      updated_at: isoHoursAgo(1),
    },
    {
      id: 'demo-packet-invalid-pricing',
      task_id: 'demo-task-invalid-review',
      run_id: 'demo-run-invalid-review',
      agent_id: 'demo-agent-evaluator-manual',
      work_type: 'pricing_analysis',
      goal: 'Analyze subscription bundle pricing.',
      artifact_url: '',
      summary: '',
      changes: 'Drafted a recommendation but omitted supporting evidence.',
      rationale: '',
      evidence: json([]),
      risks: json(['May recommend margin-negative pricing']),
      open_questions: json(['What is the minimum gross margin?']),
      suggested_next_action: '',
      schema_version: 'baton.review_packet.v1',
      sections: json([{ type: 'markdown', title: 'Incomplete draft', body: 'Needs evaluator pass before human review.' }]),
      artifacts: json([]),
      confidence_score: 0.4,
      quality_score: 0.28,
      packet_status: 'needs_evaluator',
      validator_notes: 'summary is required; suggested_next_action is required; at least one evidence item is required',
      created_at: isoHoursAgo(2),
      updated_at: isoHoursAgo(2),
    },
  ];
  for (const packet of packets) stmt.run(packet);
  return packets.length;
}

function seedRunEvents() {
  const stmt = db.prepare(`INSERT INTO run_events (run_id, event_type, from_status, to_status, actor, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const rows = [
    ['demo-run-growth-running', 'accepted', 'dispatched', 'running', 'agent', { external_run_id: 'demo-ext-growth-running' }, isoHoursAgo(1)],
    ['demo-run-growth-review-ready', 'status', 'running', 'review_ready', 'agent', { review_packet_id: 'demo-packet-valid-offer' }, isoHoursAgo(1)],
    ['demo-run-content-stale', 'accepted', 'pending_dispatch', 'running', 'operator', { transport: 'manual' }, isoHoursAgo(12)],
    ['demo-run-attribution-failed', 'failed', 'running', 'failed', 'agent', { error: 'CSV export timed out after retry budget was exhausted.' }, isoHoursAgo(4)],
    ['demo-run-vendor-completed', 'completed', 'review_ready', 'completed', 'human', { accepted: true }, isoHoursAgo(14)],
    ['demo-run-invalid-review', 'status', 'running', 'review_ready', 'agent', { review_packet_id: 'demo-packet-invalid-pricing' }, isoHoursAgo(2)],
  ];
  for (const row of rows) stmt.run(row[0], row[1], row[2], row[3], row[4], json(row[5]), row[6]);
}

function seedDemo() {
  cleanDemo();
  let created = {};
  const tx = db.transaction(() => {
    created.agents = seedAgents();
    created.tasks = seedTasks();
    created.runs = seedRuns();
    created.review_packets = seedReviewPackets();
    seedRunEvents();
    db.prepare(`
      INSERT INTO app_metadata (key, value, updated_at)
      VALUES ('demo_data', 'seed-demo', datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `).run();
    db.prepare(`UPDATE flow_settings SET current_mode = 'triage', updated_at = datetime('now') WHERE id = 'default'`).run();
  });
  tx();
  const rebuild = rebuildTouches(db);
  created.touches = counts().touches;
  return { created, rebuild };
}

if (cleanOnly) {
  const result = cleanDemo();
  console.log('BATON demo rows removed.');
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

const result = seedDemo();
console.log('BATON demo data seeded for Demo Co.');
console.log(JSON.stringify(result, null, 2));
console.log('Open http://127.0.0.1:4200/#/flow');
