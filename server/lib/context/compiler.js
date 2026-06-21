'use strict';
const { parseJson } = require('../flow/utils');

function compileDispatchContext({ db, task, touch, run, agent, intent }) {
  const baseSummary = compact([task?.title, task?.description, touch?.why_now].filter(Boolean).join('\n'), 1200);
  const humanGuidance = loadHumanGuidance(db, task?.id || run?.task_id || touch?.task_id || null);
  const sourcePacket = loadPacket(db, touch?.review_packet_id || run?.review_packet_id || null);
  const priorReview = sourcePacket ? packetSummary(sourcePacket) : loadLatestPacketForTask(db, task?.id || run?.task_id || null);
  const qualityPolicies = loadQualityPolicies(db, task, touch);

  const context = {
    summary: baseSummary,
    domain: touch?.domain || task?.domain || 'product',
    project_key: task?.project_key || touch?.project_key || null,
    risk_level: task?.risk_level || touch?.risk_level || 'low',
    autonomy_level: Number(task?.autonomy_level || touch?.autonomy_level || 1),
    human_guidance: humanGuidance,
    prior_review: priorReview,
    quality_policies: qualityPolicies,
    memory_refs: [],
  };

  if (intent === 'evaluate' && sourcePacket) {
    context.source_review_packet = sourcePacket;
    context.validator_notes = sourcePacket.validator_notes || '';
  }

  return clampContext(context, 6000);
}

function loadHumanGuidance(db, taskId) {
  if (!taskId) return [];
  return db.prepare(`
    SELECT te.event_type, te.payload, te.created_at
    FROM touch_events te
    JOIN baton_touches bt ON bt.id = te.touch_id
    WHERE bt.task_id = ? AND te.actor = 'human'
    ORDER BY te.created_at DESC, te.rowid DESC
    LIMIT 8
  `).all(taskId).map(row => {
    const payload = parseJson(row.payload, {});
    const text = [payload.feedback, payload.instructions, payload.reason].filter(Boolean).join('\n').trim();
    if (!text) return null;
    return { type: row.event_type, text: compact(text, 1000), created_at: row.created_at };
  }).filter(Boolean).reverse();
}

function loadPacket(db, packetId) {
  if (!packetId) return null;
  const row = db.prepare('SELECT * FROM review_packets WHERE id = ?').get(packetId);
  return row ? parsePacket(row) : null;
}

function loadLatestPacketForTask(db, taskId) {
  if (!taskId) return null;
  const row = db.prepare(`
    SELECT * FROM review_packets
    WHERE task_id = ?
    ORDER BY created_at DESC, rowid DESC
    LIMIT 1
  `).get(taskId);
  return row ? packetSummary(parsePacket(row)) : null;
}

function packetSummary(packet) {
  if (!packet) return null;
  return {
    id: packet.id,
    status: packet.packet_status,
    summary: compact(packet.summary || '', 1200),
    validator_notes: compact(packet.validator_notes || '', 800),
    recommended_next_action: packet.suggested_next_action || '',
    confidence_score: packet.confidence_score,
    quality_score: packet.quality_score,
  };
}

function parsePacket(row) {
  return {
    ...row,
    evidence: parseJson(row.evidence, []),
    risks: parseJson(row.risks, []),
    open_questions: parseJson(row.open_questions, []),
    sections: parseJson(row.sections, []),
    artifacts: parseJson(row.artifacts, []),
  };
}

function loadQualityPolicies(db, task, touch) {
  const rows = db.prepare(`
    SELECT id, title, body, policy_type
    FROM quality_policies
    WHERE enabled = 1
    ORDER BY updated_at DESC, created_at DESC
    LIMIT 5
  `).all();
  return rows.map(row => ({
    id: row.id,
    title: row.title,
    policy_type: row.policy_type,
    body: compact(row.body, 800),
  }));
}

function clampContext(context, maxChars) {
  let json = JSON.stringify(context);
  if (json.length <= maxChars) return context;
  const trimmed = { ...context };
  trimmed.quality_policies = [];
  json = JSON.stringify(trimmed);
  if (json.length <= maxChars) return trimmed;
  trimmed.human_guidance = (trimmed.human_guidance || []).slice(-3).map(item => ({ ...item, text: compact(item.text, 500) }));
  if (trimmed.source_review_packet) {
    trimmed.source_review_packet = {
      id: trimmed.source_review_packet.id,
      packet_status: trimmed.source_review_packet.packet_status,
      summary: compact(trimmed.source_review_packet.summary || '', 1000),
      validator_notes: compact(trimmed.source_review_packet.validator_notes || '', 800),
    };
  }
  return trimmed;
}

function compact(value, max) {
  const text = String(value || '');
  return text.length > max ? `${text.slice(0, Math.max(0, max - 3))}...` : text;
}

module.exports = { compileDispatchContext };
