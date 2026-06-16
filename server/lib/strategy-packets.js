'use strict';
const { id, stringifyJson, parseJson } = require('./flow/utils');
const { rebuildTouches } = require('./flow/rebuild');

function createStrategyPacket(db, input = {}) {
  const raw = String(input.raw_input || input.goal || '').trim();
  const parsed = parseStrategyInput(raw, input);
  if (!parsed.goal) throw new Error('goal is required');

  const packetId = id('strategy');
  const tasks = [];
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO strategy_packets (id, goal, raw_input, status, notes, created_by, task_ids)
      VALUES (?, ?, ?, 'drafted', ?, ?, '[]')
    `).run(packetId, parsed.goal, raw || parsed.goal, parsed.notes || '', input.created_by || 'operator');

    const insertTask = db.prepare(`
      INSERT INTO tasks (
        id, title, description, status, priority, owner, tags, impact_score, effort_score,
        domain, project_key, autonomy_level, risk_level, quality_gate, human_touch_minutes,
        agent_hours_unlocked, confidence_score, quality_score, strategic_optionality
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const item of parsed.items) {
      const taskId = id('task');
      const owner = item.owner || inferOwner(item.title, parsed.goal);
      const domain = item.domain || inferDomain(item.title, parsed.goal);
      const tags = Array.from(new Set(['strategy', 'dispatch-prep', ...(item.tags || [])]));
      insertTask.run(
        taskId,
        item.title,
        strategyTaskDescription({ packetId, goal: parsed.goal, item }),
        item.status || 'ready',
        item.priority || 'high',
        owner,
        stringifyJson(tags),
        item.impact_score ?? 8,
        item.effort_score ?? 3,
        domain,
        input.project_key || item.project_key || packetId,
        item.autonomy_level ?? 2,
        item.risk_level || 'low',
        item.quality_gate || 'strategy',
        item.human_touch_minutes ?? 5,
        item.agent_hours_unlocked ?? 2,
        item.confidence_score ?? 0.65,
        item.quality_score ?? 0.70,
        item.strategic_optionality ?? 0.60
      );
      tasks.push(db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId));
    }

    db.prepare(`
      UPDATE strategy_packets
      SET task_ids = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(stringifyJson(tasks.map(task => task.id)), packetId);
  });
  tx();
  rebuildTouches(db);

  return {
    packet: parsePacket(db.prepare('SELECT * FROM strategy_packets WHERE id = ?').get(packetId)),
    tasks,
    message: `Strategy packet drafted with ${tasks.length} ready task${tasks.length === 1 ? '' : 's'}. Dispatch is prepared/manual until approved.`,
  };
}

function listStrategyPackets(db, limit = 25) {
  return db.prepare(`
    SELECT * FROM strategy_packets
    ORDER BY created_at DESC
    LIMIT ?
  `).all(Number(limit || 25)).map(parsePacket);
}

function getStrategyPacket(db, packetId) {
  const packet = db.prepare('SELECT * FROM strategy_packets WHERE id = ?').get(packetId);
  if (!packet) return null;
  const parsed = parsePacket(packet);
  const tasks = parsed.task_ids.length
    ? db.prepare(`SELECT * FROM tasks WHERE id IN (${parsed.task_ids.map(() => '?').join(',')})`).all(...parsed.task_ids)
    : [];
  return { ...parsed, tasks };
}

function parseStrategyInput(raw, input = {}) {
  const goal = String(input.goal || '').trim();
  const items = Array.isArray(input.items) ? input.items.map(normalizeItem).filter(Boolean) : [];
  if (goal && items.length) return { goal, items, notes: input.notes || '' };

  const lines = raw.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const commandFirst = lines[0]?.replace(/^strategy\s*:?\s*/i, '').trim() || goal;
  const parsedGoal = goal || commandFirst;
  const bulletItems = lines.slice(1)
    .map(line => line.replace(/^[-*•]\s*/, '').trim())
    .filter(Boolean)
    .map(title => normalizeItem({ title }));

  return {
    goal: parsedGoal,
    items: bulletItems.length ? bulletItems : defaultStrategyItems(parsedGoal),
    notes: input.notes || '',
  };
}

function normalizeItem(item) {
  const title = String(item?.title || '').trim();
  if (!title) return null;
  return { ...item, title };
}

function defaultStrategyItems(goal) {
  return [
    { title: `Clarify success criteria for ${goal}`, owner: 'strategy-agent', domain: 'product', priority: 'high', effort_score: 2 },
    { title: `Map workstreams and sequencing for ${goal}`, owner: 'strategy-agent', domain: 'product', priority: 'high', effort_score: 3 },
    { title: `Prepare dispatch plan for ${goal}`, owner: 'ops-agent', domain: 'maintenance', priority: 'medium', effort_score: 3 },
  ];
}

function strategyTaskDescription({ packetId, goal, item }) {
  const acceptance = item.acceptance || 'Return a concise plan, proposed next action, risks, and any open questions.';
  return [
    `Strategy packet: ${packetId}`,
    `Goal: ${goal}`,
    '',
    item.description || 'Prepared from a high-level strategy packet. This task is ready for manual dispatch prep, not autonomous launch.',
    '',
    `Acceptance: ${acceptance}`,
  ].join('\n');
}

function inferOwner(title, goal) {
  const text = `${title} ${goal}`.toLowerCase();
  if (/code|api|server|frontend|bug|build|implement/.test(text)) return 'code-agent';
  if (/research|market|competitor|source|investigate/.test(text)) return 'research-agent';
  if (/copy|email|content|post|brand|landing/.test(text)) return 'copy-agent';
  if (/design|visual|mockup|creative/.test(text)) return 'design-agent';
  if (/ops|process|dispatch|checklist|qa|validate/.test(text)) return 'ops-agent';
  return 'strategy-agent';
}

function inferDomain(title, goal) {
  const text = `${title} ${goal}`.toLowerCase();
  if (/revenue|sales|launch|offer|ads|campaign|funnel/.test(text)) return 'revenue';
  if (/code|api|server|frontend|bug|build|implement/.test(text)) return 'code';
  if (/copy|email|content|post|brand|landing/.test(text)) return 'content';
  if (/ops|process|dispatch|checklist|qa|validate/.test(text)) return 'maintenance';
  return 'product';
}

function parsePacket(packet) {
  return packet ? { ...packet, task_ids: parseJson(packet.task_ids, []) } : null;
}

module.exports = { createStrategyPacket, listStrategyPackets, getStrategyPacket, parseStrategyInput };
