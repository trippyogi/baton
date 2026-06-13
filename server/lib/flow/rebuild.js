'use strict';
const { id, stringifyJson, parseJson } = require('./utils');
const { generateCandidates } = require('./candidates');
const { scoreTouch } = require('./ranking');
const { explainTouch } = require('./explain');

const ACTIVE_STATUSES = ['pending', 'active', 'snoozed'];

function loadSettings(db) {
  return db.prepare(`SELECT * FROM flow_settings WHERE id = 'default'`).get()
    || { id: 'default', current_mode: 'triage', max_visible_touches: 7, review_debt_limit: 5, agent_wip_limit: 12 };
}

function activeWhere() {
  return `status IN (${ACTIVE_STATUSES.map(() => '?').join(',')})`;
}

function keyFor(t) {
  return [t.source || 'generated', t.type || '', t.task_id || '', t.run_id || '', t.agent_id || ''].join('|');
}

function rowKey(row) {
  return [row.source || 'generated', row.type || '', row.task_id || '', row.run_id || '', row.agent_id || ''].join('|');
}

function upsertTouch(db, touch, context) {
  const score = scoreTouch(touch, context);
  const why = explainTouch({ ...touch, score }, context);
  const existing = db.prepare(`
    SELECT * FROM baton_touches
    WHERE source = 'generated' AND type = ?
      AND COALESCE(task_id, '') = COALESCE(?, '')
      AND COALESCE(run_id, '') = COALESCE(?, '')
      AND COALESCE(agent_id, '') = COALESCE(?, '')
      AND ${activeWhere()}
    LIMIT 1
  `).get(touch.type, touch.task_id, touch.run_id, touch.agent_id, ...ACTIVE_STATUSES);

  if (existing) {
    const preserved = {
      manual_priority_boost: existing.manual_priority_boost || 0,
      pinned: existing.pinned || 0,
      manual_override_until: existing.manual_override_until || null,
    };
    const score = scoreTouch({ ...touch, ...preserved }, context);
    db.prepare(`
      UPDATE baton_touches SET
        title=@title, description=@description, primary_action=@primary_action,
        secondary_actions=@secondary_actions, why_now=@why_now, domain=@domain,
        project_key=@project_key, context_key=@context_key, mode_fit=@mode_fit,
        portfolio_weight=@portfolio_weight, impact_score=@impact_score, effort_score=@effort_score,
        urgency_score=@urgency_score, confidence_score=@confidence_score, quality_score=@quality_score,
        risk_score=@risk_score, fun_score=@fun_score, strategic_optionality=@strategic_optionality,
        starvation_score=@starvation_score, context_switch_cost=@context_switch_cost,
        human_touch_minutes=@human_touch_minutes, agent_hours_unlocked=@agent_hours_unlocked,
        autonomy_level=@autonomy_level, risk_level=@risk_level, review_packet_id=@review_packet_id,
        score=@score, generated_at=datetime('now'), updated_at=datetime('now')
      WHERE id=@id
    `).run({ ...touch, ...preserved, id: existing.id, secondary_actions: stringifyJson(touch.secondary_actions || []), why_now: why, score });
    return { id: existing.id, updated: true };
  }

  const touchId = id('touch');
  db.prepare(`
    INSERT INTO baton_touches (
      id, task_id, run_id, agent_id, title, description, type, status, primary_action,
      secondary_actions, why_now, domain, project_key, context_key, mode_fit, portfolio_weight,
      impact_score, effort_score, urgency_score, confidence_score, quality_score, risk_score,
      fun_score, strategic_optionality, starvation_score, context_switch_cost, human_touch_minutes,
      agent_hours_unlocked, autonomy_level, risk_level, review_packet_id, score, source
    ) VALUES (
      @id, @task_id, @run_id, @agent_id, @title, @description, @type, @status, @primary_action,
      @secondary_actions, @why_now, @domain, @project_key, @context_key, @mode_fit, @portfolio_weight,
      @impact_score, @effort_score, @urgency_score, @confidence_score, @quality_score, @risk_score,
      @fun_score, @strategic_optionality, @starvation_score, @context_switch_cost, @human_touch_minutes,
      @agent_hours_unlocked, @autonomy_level, @risk_level, @review_packet_id, @score, 'generated'
    )
  `).run({ ...touch, id: touchId, secondary_actions: stringifyJson(touch.secondary_actions || []), why_now: why, score });
  db.prepare(`INSERT INTO touch_events (id, touch_id, event_type, payload) VALUES (?, ?, 'generated', ?)`)
    .run(id('event'), touchId, stringifyJson({ source: 'rebuild' }));
  return { id: touchId, generated: true };
}

function reactivateExpiredSnoozes(db) {
  return db.prepare(`
    UPDATE baton_touches
    SET status = 'pending', snoozed_until = NULL, updated_at = datetime('now')
    WHERE status = 'snoozed'
      AND snoozed_until IS NOT NULL
      AND snoozed_until <= datetime('now')
  `).run().changes;
}

function rankOpenTouches(db) {
  reactivateExpiredSnoozes(db);
  const rows = db.prepare(`
    SELECT id FROM baton_touches
    WHERE status IN ('pending', 'active')
      AND (snoozed_until IS NULL OR snoozed_until <= datetime('now'))
    ORDER BY pinned DESC, score DESC, created_at ASC
  `).all();
  const update = db.prepare('UPDATE baton_touches SET rank = ?, updated_at = datetime(\'now\') WHERE id = ?');
  rows.forEach((row, index) => update.run(index + 1, row.id));
}

function rebuildTouches(db) {
  const started = Date.now();
  const settings = loadSettings(db);
  const context = { mode: settings.current_mode || 'triage' };
  const candidates = generateCandidates(db, context);
  let generated = 0;
  let updated = 0;
  let archived = 0;
  const candidateKeys = new Set(candidates.map(c => keyFor({ ...c, source: 'generated' })));

  let reactivated = 0;

  const tx = db.transaction(() => {
    reactivated = reactivateExpiredSnoozes(db);
    for (const candidate of candidates) {
      const result = upsertTouch(db, candidate, context);
      if (result.generated) generated += 1;
      if (result.updated) updated += 1;
    }

    const openGenerated = db.prepare(`SELECT * FROM baton_touches WHERE source = 'generated' AND ${activeWhere()}`).all(...ACTIVE_STATUSES);
    for (const row of openGenerated) {
      if (!candidateKeys.has(rowKey(row)) && row.status !== 'snoozed') {
        db.prepare(`UPDATE baton_touches SET status = 'archived', updated_at = datetime('now') WHERE id = ?`).run(row.id);
        archived += 1;
      }
    }
    rankOpenTouches(db);
  });
  tx();

  return { generated, updated, archived, reactivated, duration_ms: Date.now() - started };
}

function listOpenTouches(db, limit = 7) {
  reactivateExpiredSnoozes(db);
  const rows = db.prepare(`
    SELECT * FROM baton_touches
    WHERE status IN ('pending', 'active')
      AND (snoozed_until IS NULL OR snoozed_until <= datetime('now'))
    ORDER BY pinned DESC, score DESC, created_at ASC
    LIMIT ?
  `).all(limit);
  return rows.map(parseTouch);
}

function parseTouch(t) {
  return { ...t, secondary_actions: parseJson(t.secondary_actions, []) };
}

module.exports = { loadSettings, rebuildTouches, listOpenTouches, parseTouch, rankOpenTouches, reactivateExpiredSnoozes };
