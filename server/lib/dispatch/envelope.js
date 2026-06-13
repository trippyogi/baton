'use strict';
const { id, parseJson } = require('../flow/utils');

function buildDispatchEnvelope({ run, task, touch, agent, settings, baseUrl, instructions = [], intent = 'orchestrate' }) {
  const safeBase = String(baseUrl || 'http://127.0.0.1:4200').replace(/\/$/, '');
  const dispatchId = id('dispatch');
  const objective = task?.description || touch?.description || `Work on: ${task?.title || touch?.title || run?.id}`;
  return {
    schema: 'baton.dispatch.v1',
    dispatch_id: dispatchId,
    run_id: run.id,
    task_id: task?.id || run.task_id || null,
    touch_id: touch?.id || run.touch_id || null,
    agent_id: agent?.id || run.agent_id || null,
    intent,
    priority: task?.priority || 'medium',
    mode: settings?.current_mode || 'triage',
    title: task?.title || touch?.title || 'BATON dispatch',
    objective,
    instructions: instructions.length ? instructions : [
      'Keep context tight.',
      'Prioritize decisions that unblock execution.',
      'Return a review packet with recommended next action.',
      'Do not claim external actions were completed unless actually done.',
    ],
    context: {
      summary: compactSummary(task, touch),
      domain: touch?.domain || task?.domain || 'product',
      project_key: task?.project_key || touch?.project_key || null,
      risk_level: task?.risk_level || touch?.risk_level || 'low',
      autonomy_level: Number(task?.autonomy_level || touch?.autonomy_level || 1),
    },
    attachments: parseJson(task?.source_links || '[]', []),
    callbacks: {
      ack_url: `${safeBase}/api/runs/${run.id}/ack`,
      status_url: `${safeBase}/api/runs/${run.id}/status`,
      review_packet_url: `${safeBase}/api/review-packets`,
    },
    constraints: {
      max_context_chars: 6000,
      expected_output: 'review_packet',
      no_external_spend: true,
      no_public_posting: true,
    },
  };
}

function compactSummary(task, touch) {
  const raw = [task?.title, task?.description, touch?.why_now].filter(Boolean).join('\n');
  return raw.length > 1200 ? `${raw.slice(0, 1197)}...` : raw;
}

module.exports = { buildDispatchEnvelope };
