'use strict';

const ACTIONS_BY_TYPE = {
  blocker: new Set(['answer', 'snooze', 'escalate', 'archive']),
  review: new Set(['accept', 'refine', 'send_to_evaluator', 'snooze', 'archive', 'inspect']),
  refine: new Set(['send_to_evaluator', 'snooze', 'archive', 'inspect']),
  delegate: new Set(['delegate', 'snooze', 'archive']),
  capture: new Set(['process', 'delegate', 'snooze', 'archive']),
  stale_run: new Set(['inspect', 'snooze', 'archive', 'escalate']),
  idle_agent: new Set(['assign', 'snooze', 'archive']),
};

function isActionAllowed(type, action) {
  return Boolean(ACTIONS_BY_TYPE[type]?.has(action));
}

function allowedActions(type) {
  return Array.from(ACTIONS_BY_TYPE[type] || []);
}

module.exports = { ACTIONS_BY_TYPE, isActionAllowed, allowedActions };
