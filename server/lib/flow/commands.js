'use strict';
const { id, stringifyJson, parseJson } = require('./utils');
const { normalizeMode, VALID_MODES } = require('./modes');
const { rebuildTouches, listOpenTouches } = require('./rebuild');

function createTask(db, {
  title,
  description = '',
  status = 'inbox',
  priority = 'medium',
  owner = 'jeremy',
  tags = [],
  domain = 'product',
  project_key = null,
  autonomy_level = 1,
  risk_level = 'low',
  quality_gate = 'general',
  human_touch_minutes = 5,
  agent_hours_unlocked = 0.5,
  impact_score = 5,
  effort_score = 5,
}) {
  const taskId = id('task');
  db.prepare(`
    INSERT INTO tasks (
      id, title, description, status, priority, owner, tags, impact_score, effort_score,
      domain, project_key, autonomy_level, risk_level, quality_gate, human_touch_minutes, agent_hours_unlocked
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(taskId, title, description, status, priority, owner, stringifyJson(tags), impact_score, effort_score, domain, project_key, autonomy_level, risk_level, quality_gate, human_touch_minutes, agent_hours_unlocked);
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
}

function executeCommand(db, input) {
  const raw = String(input || '').trim();
  const lower = raw.toLowerCase();
  if (!raw) return { interpreted_as: 'empty', message: 'Nothing to do.' };

  if (lower === 'triage') {
    db.prepare(`UPDATE flow_settings SET current_mode = 'triage', updated_at = datetime('now') WHERE id = 'default'`).run();
    rebuildTouches(db);
    return { interpreted_as: 'mode', mode: 'triage', message: 'Mode set to triage.' };
  }

  if (lower.startsWith('mode ')) {
    const mode = normalizeMode(raw.slice(5));
    if (!VALID_MODES.includes(mode)) return { interpreted_as: 'mode', error: `Unknown mode: ${mode}` };
    db.prepare(`UPDATE flow_settings SET current_mode = ?, updated_at = datetime('now') WHERE id = 'default'`).run(mode);
    rebuildTouches(db);
    return { interpreted_as: 'mode', mode, message: `Mode set to ${mode.replace(/_/g, ' ')}.` };
  }

  if (lower === 'review next') {
    rebuildTouches(db);
    const touch = listOpenTouches(db, 25).find(t => t.type === 'review') || null;
    return { interpreted_as: 'review_next', touch, message: touch ? 'Opened next review touch.' : 'No review touches are ready.' };
  }

  if (lower.includes('what needs')) {
    rebuildTouches(db);
    return { interpreted_as: 'next_touches', next_touches: listOpenTouches(db, 7), message: 'Here is what needs you next.' };
  }

  if (lower === 'idle agents') {
    rebuildTouches(db);
    const agents = db.prepare(`SELECT * FROM agents WHERE status = 'idle' ORDER BY name`).all()
      .map(agent => ({ ...agent, skills: parseJson(agent.skills, []), permissions: parseJson(agent.permissions, {}) }));
    const touches = listOpenTouches(db, 50).filter(t => t.type === 'idle_agent');
    return { interpreted_as: 'idle_agents', agents, touches, message: `${agents.length} idle agents. ${touches.length} assignment candidates ready.` };
  }

  const spectreMatch = raw.match(/^(?:delegate|assign)\s+spectre\s+(.+)$/i) || raw.match(/^spectre\s+(.+)$/i);
  if (spectreMatch) {
    const title = spectreMatch[1].trim();
    const task = createTask(db, {
      title,
      status: 'ready',
      priority: 'high',
      owner: 'spectre',
      tags: ['spectre', 'metatravelers', 'launch'],
      domain: 'revenue',
      project_key: 'metatravelers',
      autonomy_level: 3,
      risk_level: 'medium',
      quality_gate: 'strategy',
      human_touch_minutes: 3,
      agent_hours_unlocked: 2,
      impact_score: 8,
      effort_score: 2,
    });
    rebuildTouches(db);
    const touch = db.prepare(`SELECT * FROM baton_touches WHERE task_id = ? AND type = 'idle_agent' ORDER BY created_at DESC LIMIT 1`).get(task.id)
      || db.prepare(`SELECT * FROM baton_touches WHERE task_id = ? ORDER BY created_at DESC LIMIT 1`).get(task.id);
    return { interpreted_as: 'delegate_spectre', created: { task_id: task.id, touch_id: touch?.id || null }, message: 'Created a Spectre-ready task and assignment touch.' };
  }

  if (lower.startsWith('delegate ')) {
    const title = raw.slice(9).trim();
    const task = createTask(db, { title, status: 'ready', priority: 'medium' });
    rebuildTouches(db);
    const touch = db.prepare(`SELECT * FROM baton_touches WHERE task_id = ? AND type = 'delegate' ORDER BY created_at DESC LIMIT 1`).get(task.id);
    return { interpreted_as: 'delegate', created: { task_id: task.id, touch_id: touch?.id || null }, message: 'Created a ready task and delegation touch.' };
  }

  let title = raw;
  let interpreted = 'capture';
  if (lower.startsWith('capture ')) title = raw.slice(8).trim();
  else if (lower.startsWith('idea ')) { title = raw.slice(5).trim(); interpreted = 'idea'; }
  else interpreted = 'fallback_capture';

  const task = createTask(db, { title, status: 'inbox', priority: 'medium' });
  rebuildTouches(db);
  const touch = db.prepare(`SELECT * FROM baton_touches WHERE task_id = ? AND type = 'capture' ORDER BY created_at DESC LIMIT 1`).get(task.id);
  return { interpreted_as: interpreted, created: { task_id: task.id, touch_id: touch?.id || null }, message: 'Captured to inbox and added a processing touch.' };
}

module.exports = { executeCommand };
