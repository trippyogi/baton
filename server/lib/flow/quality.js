'use strict';
const { parseJson } = require('./utils');

function normalizeList(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string') {
    const parsed = parseJson(value, null);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    return value.trim() ? [value.trim()] : [];
  }
  return [];
}

function validateReviewPacket(packet) {
  const notes = [];
  if (!String(packet.goal || '').trim()) notes.push('goal is required');
  if (!String(packet.summary || '').trim()) notes.push('summary is required');
  if (!String(packet.suggested_next_action || '').trim()) notes.push('suggested_next_action is required');
  if (!normalizeList(packet.evidence).length) notes.push('at least one evidence item is required');
  if (packet.confidence_score == null || Number.isNaN(Number(packet.confidence_score))) notes.push('confidence_score is required');
  if (packet.quality_score == null || Number.isNaN(Number(packet.quality_score))) notes.push('quality_score is required');
  return {
    valid: notes.length === 0,
    packet_status: notes.length === 0 ? 'valid' : 'needs_evaluator',
    validator_notes: notes.join('; '),
  };
}

module.exports = { validateReviewPacket, normalizeList };
