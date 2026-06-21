'use strict';
const { parseJson } = require('./utils');

const SECTION_TYPES = new Set(['markdown', 'bullets', 'checklist', 'decision_matrix', 'diff_summary', 'test_results', 'research_notes', 'wireframe_link']);
const ARTIFACT_TYPES = new Set(['markdown', 'diff', 'test_log', 'url', 'file', 'image', 'report']);

function normalizeList(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string') {
    const parsed = parseJson(value, null);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    return value.trim() ? [value.trim()] : [];
  }
  return [];
}

function normalizeSections(value) {
  const items = parseArray(value);
  return items.map((item) => {
    if (typeof item === 'string') return { type: 'markdown', body: clamp(item, 4000) };
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const out = { ...item };
    out.type = String(out.type || 'markdown');
    if (!SECTION_TYPES.has(out.type)) out.type = `custom:${out.type}`;
    if (out.title != null) out.title = clamp(out.title, 200);
    if (out.body != null) out.body = clamp(out.body, 4000);
    if (Array.isArray(out.items)) out.items = out.items.map(v => typeof v === 'object' ? v : String(v)).slice(0, 100);
    return out;
  }).filter(Boolean);
}

function normalizeArtifacts(value) {
  const items = parseArray(value);
  return items.map((item) => {
    if (typeof item === 'string') return { type: 'url', url: clamp(item, 1000) };
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const out = { ...item };
    out.type = String(out.type || 'file');
    if (!ARTIFACT_TYPES.has(out.type)) out.type = `custom:${out.type}`;
    if (out.name != null) out.name = clamp(out.name, 240);
    if (out.url != null) out.url = clamp(out.url, 1000);
    if (out.path != null) out.path = clamp(out.path, 1000);
    if (out.summary != null) out.summary = clamp(out.summary, 2000);
    return out;
  }).filter(Boolean);
}

function normalizeScore(value, fallback = 0.7) {
  const n = Number(value ?? fallback);
  if (Number.isNaN(n)) return fallback;
  return Math.max(0, Math.min(1, n));
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

function parseArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    const parsed = parseJson(value, null);
    if (Array.isArray(parsed)) return parsed;
    return value.trim() ? [value.trim()] : [];
  }
  return [];
}

function clamp(value, max) {
  const text = String(value || '');
  return text.length > max ? `${text.slice(0, Math.max(0, max - 3))}...` : text;
}

module.exports = { validateReviewPacket, normalizeList, normalizeSections, normalizeArtifacts, normalizeScore };
