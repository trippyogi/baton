'use strict';

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function explainTouch(touch, context = {}) {
  const reasons = [];
  if ((touch.impact_score ?? 0) >= 8) reasons.push('high impact');
  if (touch.domain === 'revenue') reasons.push('revenue-linked');
  if (touch.type === 'blocker') reasons.push('blocks progress');
  if (touch.type === 'review') reasons.push('ready for review');
  if (touch.type === 'delegate') reasons.push('ready to pass');
  if (touch.type === 'idle_agent') reasons.push('idle agent matched to ready work');
  if (touch.type === 'refine') reasons.push('needs evaluator/refiner pass-off');
  if (touch.type === 'capture') reasons.push('prevents idea loss');
  if (touch.type === 'stale_run') reasons.push('airborne work may be stale');
  if ((touch.agent_hours_unlocked ?? 0) >= 2) reasons.push(`unlocks ~${touch.agent_hours_unlocked}h agent work`);
  if ((touch.human_touch_minutes ?? 5) <= 3) reasons.push(`${touch.human_touch_minutes}m touch`);
  if (context.mode === 'launch' && touch.domain === 'revenue') reasons.push('launch mode boost');
  if ((touch.starvation_score ?? 0) > 0.7) reasons.push('domain has been starved');
  return reasons.length
    ? capitalize(`${reasons.join(', ')}.`)
    : 'Ranks well for current mode and available context.';
}

module.exports = { explainTouch };
