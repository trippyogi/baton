'use strict';
const { clamp01 } = require('./utils');
const { MODE_WEIGHTS } = require('./modes');

const DEFAULTS = {
  impact_score: 5,
  effort_score: 5,
  urgency_score: 0.3,
  confidence_score: 0.7,
  quality_score: 0.7,
  risk_score: 0.3,
  mode_fit: 0.5,
  portfolio_weight: 1.0,
  starvation_score: 0.0,
  context_switch_cost: 0.5,
  human_touch_minutes: 5,
  agent_hours_unlocked: 0.5,
  fun_score: 0.0,
  strategic_optionality: 0.0,
};

function scoreTouch(touch, context = {}) {
  const mode = context.mode || 'triage';
  const impact = clamp01((touch.impact_score ?? DEFAULTS.impact_score) / 10);
  const confidence = clamp01(touch.confidence_score ?? DEFAULTS.confidence_score);
  const quality = clamp01(touch.quality_score ?? DEFAULTS.quality_score);
  const risk = clamp01(touch.risk_score ?? DEFAULTS.risk_score);
  const modeWeight = MODE_WEIGHTS[mode]?.[touch.type] ?? 1.0;
  const modeFit = clamp01((touch.mode_fit ?? DEFAULTS.mode_fit) * modeWeight);
  const portfolioWeight = touch.portfolio_weight ?? DEFAULTS.portfolio_weight;
  const starvation = clamp01(touch.starvation_score ?? DEFAULTS.starvation_score);
  const contextSwitch = clamp01(touch.context_switch_cost ?? DEFAULTS.context_switch_cost);
  const touchMinutes = touch.human_touch_minutes ?? DEFAULTS.human_touch_minutes;
  const agentHoursUnlocked = touch.agent_hours_unlocked ?? DEFAULTS.agent_hours_unlocked;

  const baseValue = 100 * impact * confidence * quality;
  const agentMotionBonus = Math.min(agentHoursUnlocked * 12, 30);
  const modeBonus = modeFit * 20;
  const portfolioBonus = (portfolioWeight - 1.0) * 20;
  const starvationBonus = starvation * 15;
  const urgencyBonus = clamp01(touch.urgency_score ?? DEFAULTS.urgency_score) * 15;
  const reviewAgeBonus = clamp01((touch.review_age_hours || 0) / 24) * 10;
  const blockedAgeBonus = clamp01((touch.blocked_age_hours || 0) / 12) * 15;
  const idleAgentBonus = touch.idle_agent_fit ? 12 : 0;
  const funOptionBonus = mode === 'strategy_creative'
    ? clamp01(touch.fun_score ?? 0) * 10 + clamp01(touch.strategic_optionality ?? 0) * 10
    : clamp01(touch.strategic_optionality ?? 0) * 5;

  const humanTouchPenalty = Math.min(touchMinutes * 1.5, 20);
  const contextSwitchPenalty = contextSwitch * 20;
  const riskPenalty = risk * 20;
  const unclearSpecPenalty = touch.spec_quality === 'weak' ? 15 : 0;
  const reviewDebtPenalty = context.reviewDebtHigh && touch.type === 'delegate' ? 10 : 0;
  const manualBoost = clamp01(touch.manual_priority_boost ?? 0) * 20;
  const pinnedBonus = Number(touch.pinned || 0) ? 30 : 0;

  const raw = Math.round(
    baseValue + agentMotionBonus + modeBonus + portfolioBonus + starvationBonus + urgencyBonus +
    reviewAgeBonus + blockedAgeBonus + idleAgentBonus + funOptionBonus + manualBoost + pinnedBonus - humanTouchPenalty -
    contextSwitchPenalty - riskPenalty - unclearSpecPenalty - reviewDebtPenalty
  );
  return Math.max(0, Math.min(100, raw));
}

module.exports = { DEFAULTS, scoreTouch };
