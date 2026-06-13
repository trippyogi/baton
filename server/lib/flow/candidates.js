'use strict';
const { hoursSince } = require('./utils');
const { STALE_THRESHOLDS_MINUTES } = require('./modes');
const { getPortfolioMap, domainMeta, starvationScore } = require('./portfolio');

const SECONDARY_ACTIONS = {
  blocker: ['snooze', 'escalate', 'archive'],
  review: ['refine', 'accept', 'snooze', 'archive'],
  delegate: ['snooze', 'archive'],
  capture: ['delegate', 'archive', 'snooze'],
  stale_run: ['snooze', 'archive', 'escalate'],
};

function taskDomain(task) {
  if (task.domain) return task.domain;
  const tags = String(task.tags || '').toLowerCase();
  const text = `${task.title || ''} ${task.description || ''} ${tags}`.toLowerCase();
  if (/revenue|sales|checkout|cart|campaign|ads|funnel|purchase/.test(text)) return 'revenue';
  if (/code|engineering|server|api|frontend|bug|refactor/.test(text)) return 'code';
  if (/copy|content|brand|carousel|email/.test(text)) return 'content';
  if (/admin|billing|invoice|tax/.test(text)) return 'admin';
  if (/maintenance|cleanup|ops/.test(text)) return 'maintenance';
  return 'product';
}

function candidateFromTask(task, attrs, portfolioMap) {
  const domain = taskDomain(task);
  const meta = domainMeta(portfolioMap, domain);
  const ageHours = hoursSince(task.updated_at || task.created_at);
  return {
    task_id: task.id,
    run_id: null,
    agent_id: null,
    title: attrs.title,
    description: task.description || '',
    type: attrs.type,
    status: 'pending',
    primary_action: attrs.primary_action,
    secondary_actions: SECONDARY_ACTIONS[attrs.type] || ['snooze', 'archive'],
    why_now: '',
    domain,
    project_key: task.project_key || null,
    context_key: task.context_key || null,
    mode_fit: attrs.mode_fit ?? 0.5,
    portfolio_weight: Number(meta.weight || 1),
    impact_score: Number(task.impact_score || 5) || 5,
    effort_score: Number(task.effort_score || 5) || 5,
    urgency_score: attrs.urgency_score ?? urgencyFor(task),
    confidence_score: Number(task.confidence_score || 0.7),
    quality_score: Number(task.quality_score || 0.7),
    risk_score: riskScore(task.risk_level),
    fun_score: Number(task.fun_score || 0),
    strategic_optionality: Number(task.strategic_optionality || 0),
    starvation_score: starvationScore(meta),
    context_switch_cost: attrs.context_switch_cost ?? 0.45,
    human_touch_minutes: Number(task.human_touch_minutes || attrs.human_touch_minutes || 5),
    agent_hours_unlocked: Number(task.agent_hours_unlocked || attrs.agent_hours_unlocked || 0.5),
    autonomy_level: Number(task.autonomy_level || 1),
    risk_level: task.risk_level || 'low',
    review_packet_id: null,
    spec_quality: task.spec_quality || 'unknown',
    review_age_hours: attrs.type === 'review' ? ageHours : 0,
    blocked_age_hours: attrs.type === 'blocker' ? ageHours : 0,
  };
}

function urgencyFor(task) {
  if (task.priority === 'critical') return 0.95;
  if (task.priority === 'high') return 0.75;
  if (task.priority === 'medium') return 0.35;
  return 0.2;
}

function riskScore(riskLevel) {
  return ({ low: 0.2, medium: 0.45, high: 0.75, critical: 1.0 })[riskLevel] ?? 0.3;
}

function generateCandidates(db, context = {}) {
  const portfolioMap = getPortfolioMap(db);
  const tasks = db.prepare(`SELECT * FROM tasks WHERE status NOT IN ('done', 'backlog', 'archived')`).all();
  const candidates = [];
  const staleThresholdHours = (STALE_THRESHOLDS_MINUTES[context.mode || 'triage'] || 30) / 60;

  for (const task of tasks) {
    if (task.status === 'waiting') {
      candidates.push(candidateFromTask(task, {
        type: 'blocker',
        primary_action: 'answer',
        title: `Answer blocker: ${task.title}`,
        mode_fit: 0.8,
        human_touch_minutes: 3,
        agent_hours_unlocked: 1.5,
      }, portfolioMap));
    } else if (task.status === 'review') {
      candidates.push(candidateFromTask(task, {
        type: 'review',
        primary_action: 'review',
        title: `Review: ${task.title}`,
        mode_fit: 0.75,
        human_touch_minutes: 7,
        agent_hours_unlocked: 1,
      }, portfolioMap));
    } else if (task.status === 'ready') {
      candidates.push(candidateFromTask(task, {
        type: 'delegate',
        primary_action: 'delegate',
        title: `Delegate: ${task.title}`,
        mode_fit: 0.65,
        human_touch_minutes: 5,
        agent_hours_unlocked: 2,
      }, portfolioMap));
    } else if (task.status === 'inbox') {
      candidates.push(candidateFromTask(task, {
        type: 'capture',
        primary_action: 'process',
        title: `Process capture: ${task.title}`,
        mode_fit: 0.45,
        human_touch_minutes: 4,
        agent_hours_unlocked: 0.5,
      }, portfolioMap));
    } else if (task.status === 'in_progress' && hoursSince(task.updated_at || task.created_at) >= staleThresholdHours) {
      candidates.push(candidateFromTask(task, {
        type: 'stale_run',
        primary_action: 'inspect',
        title: `Inspect stale work: ${task.title}`,
        mode_fit: 0.7,
        human_touch_minutes: 4,
        agent_hours_unlocked: 1,
      }, portfolioMap));
    }
  }

  return candidates;
}

module.exports = { generateCandidates };
