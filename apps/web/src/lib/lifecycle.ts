// @ts-nocheck
/** Shared lifecycle badge helpers for touch / run / dispatch states. */

const TOUCH_STATUSES = new Set([
  'pending', 'active', 'prepared', 'snoozed', 'passed', 'resolved', 'archived', 'superseded',
]);

const DISPATCH_STATUSES = new Set([
  'not_configured', 'prepared', 'queued', 'accepted', 'running', 'failed', 'rejected',
  'completed', 'cancelled', 'timed_out',
]);

const RUN_STATUSES = new Set([
  'pending', 'pending_dispatch', 'running', 'review_ready', 'completed', 'failed',
  'cancelled', 'error', 'success',
]);

export function normalizeLifecycle(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

export function labelLifecycle(value) {
  const raw = String(value || 'unknown').replace(/_/g, ' ');
  return raw.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function lifecycleKind(value) {
  const key = normalizeLifecycle(value);
  if (TOUCH_STATUSES.has(key)) return 'touch';
  if (DISPATCH_STATUSES.has(key)) return 'dispatch';
  if (RUN_STATUSES.has(key)) return 'run';
  return 'generic';
}

export function lifecycleBadge(value, { kind, title } = {}) {
  const key = normalizeLifecycle(value) || 'unknown';
  const resolvedKind = kind || lifecycleKind(key);
  const label = labelLifecycle(key);
  const tip = title || `${resolvedKind} lifecycle: ${label}`;
  return `<span class="badge badge-lifecycle badge-${escapeClass(key)} badge-kind-${escapeClass(resolvedKind)}" title="${escapeAttr(tip)}">${escapeHtml(label)}</span>`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[ch]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function escapeClass(value) {
  return String(value || 'unknown').replace(/[^a-z0-9_-]/gi, '');
}
