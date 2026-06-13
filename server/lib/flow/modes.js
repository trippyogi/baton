'use strict';

const VALID_MODES = [
  'deep_build',
  'triage',
  'review',
  'strategy_creative',
  'launch',
  'admin',
  'cleanup',
  'recovery',
];

const MODE_WEIGHTS = {
  deep_build: { review: 0.7, blocker: 1.2, delegate: 1.0, capture: 0.7, idle_agent: 0.9, stale_run: 0.9, refine: 0.9 },
  triage: { review: 1.1, blocker: 1.4, delegate: 1.0, capture: 1.1, idle_agent: 1.2, stale_run: 1.3, refine: 1.1 },
  review: { review: 1.5, blocker: 1.0, delegate: 0.6, capture: 0.6, idle_agent: 0.5, stale_run: 1.0, refine: 1.2 },
  strategy_creative: { review: 0.8, blocker: 0.9, delegate: 1.0, capture: 1.4, idle_agent: 0.8, stale_run: 0.7, policy_candidate: 1.2, refine: 1.0 },
  launch: { review: 1.2, blocker: 1.5, delegate: 1.1, capture: 0.5, idle_agent: 1.0, stale_run: 1.2, refine: 1.0 },
  admin: { review: 0.8, blocker: 1.0, delegate: 0.7, capture: 0.7, idle_agent: 0.5, stale_run: 1.0, refine: 0.8 },
  cleanup: { review: 1.2, blocker: 1.1, delegate: 0.5, capture: 0.8, idle_agent: 0.4, stale_run: 1.4, policy_candidate: 1.3, refine: 1.1 },
  recovery: { review: 0.8, blocker: 0.8, delegate: 0.5, capture: 1.0, idle_agent: 0.3, stale_run: 0.5, refine: 0.8 },
};

const STALE_THRESHOLDS_MINUTES = {
  deep_build: 90,
  triage: 30,
  review: 120,
  strategy_creative: 120,
  launch: 30,
  admin: 240,
  cleanup: 120,
  recovery: 240,
};

function normalizeMode(input) {
  const mode = String(input || '').trim().toLowerCase().replace(/[ -]+/g, '_');
  if (mode === 'deep') return 'deep_build';
  if (mode === 'strategy') return 'strategy_creative';
  return mode;
}

module.exports = { VALID_MODES, MODE_WEIGHTS, STALE_THRESHOLDS_MINUTES, normalizeMode };
