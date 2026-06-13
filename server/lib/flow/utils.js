'use strict';
const { randomUUID } = require('crypto');

function clamp01(n) {
  if (Number.isNaN(Number(n))) return 0;
  return Math.max(0, Math.min(1, Number(n)));
}

function parseJson(value, fallback) {
  try { return JSON.parse(value || ''); }
  catch (_) { return fallback; }
}

function stringifyJson(value) {
  return JSON.stringify(value ?? null);
}

function hoursSince(iso) {
  if (!iso) return 999;
  return Math.max(0, (Date.now() - new Date(iso).getTime()) / 36e5);
}

function nowIso() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${randomUUID()}`;
}

module.exports = { clamp01, parseJson, stringifyJson, hoursSince, nowIso, id };
