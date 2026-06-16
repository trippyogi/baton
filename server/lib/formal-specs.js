'use strict';

const { createStrategyPacket } = require('./strategy-packets');
const { id, stringifyJson, parseJson } = require('./flow/utils');

function createFormalSpecPacket(db, input = {}) {
  const markdown = String(input.markdown || input.body || input.raw_input || '').trim();
  if (!markdown) throw new Error('markdown is required');

  const parsed = parseFormalSpec(markdown, input);
  const result = createStrategyPacket(db, {
    goal: parsed.goal,
    items: parsed.items,
    notes: parsed.notes,
    created_by: input.created_by || 'formal-spec-intake',
    project_key: parsed.projectKey,
  });
  const record = insertFormalSpecRecord(db, {
    markdown,
    parsed,
    packetId: result.packet.id,
    input,
  });
  return {
    formal_spec: record,
    spec: parsed.spec,
    ...result,
  };
}

function insertFormalSpecRecord(db, { markdown, parsed, packetId, input }) {
  const specId = id('spec');
  db.prepare(`
    INSERT INTO formal_specs (
      id, packet_id, project, target_repository, spec_version, selected_phase,
      include_all_phases, markdown, parsed_json, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    specId,
    packetId,
    parsed.spec.project,
    parsed.spec.target_repository || '',
    parsed.spec.spec_version || '',
    input.phase || '',
    input.include_all_phases === true || input.phase === 'all' ? 1 : 0,
    markdown,
    stringifyJson(parsed.spec),
    input.created_by || 'formal-spec-intake'
  );
  return getFormalSpec(db, specId);
}

function listFormalSpecs(db, limit = 25) {
  return db.prepare(`
    SELECT id, packet_id, project, target_repository, spec_version, selected_phase,
           include_all_phases, created_by, created_at
    FROM formal_specs
    ORDER BY created_at DESC
    LIMIT ?
  `).all(Number(limit || 25)).map(parseFormalSpecRecord);
}

function getFormalSpec(db, specId) {
  const record = db.prepare('SELECT * FROM formal_specs WHERE id = ?').get(specId);
  return parseFormalSpecRecord(record);
}

function parseFormalSpecRecord(record) {
  return record ? {
    ...record,
    include_all_phases: Boolean(record.include_all_phases),
    parsed: record.parsed_json ? parseJson(record.parsed_json, {}) : undefined,
  } : null;
}

function parseFormalSpec(markdown, input = {}) {
  const project = firstMatch(markdown, /^\*\*Project:\*\*\s*(.+)$/mi) || input.project || 'Formal Spec';
  const targetRepository = firstMatch(markdown, /^\*\*Target repository:\*\*\s*`?([^`\n]+)`?$/mi) || input.target_repository || '';
  const specVersion = firstMatch(markdown, /^\*\*Spec version:\*\*\s*(.+)$/mi) || input.spec_version || '';
  const flagship = firstMatch(markdown, /^\*\*Flagship v0 mission pack:\*\*\s*(.+)$/mi) || '';
  const oneSentence = firstMatch(markdown, /^###\s+1\.1\s+One-sentence definition\s+\n+\*\*(.+?)\*\*/mis) || '';
  const roadmap = parseRoadmap(markdown);
  const selectedRoadmap = selectRoadmapPhases(roadmap, input);
  const items = selectedRoadmap.some(phase => phase.deliverables?.length)
    ? selectedRoadmap.flatMap(phase => phase.deliverables.map(deliverable => roadmapTask(deliverable, { project, targetRepository, phase })))
    : defaultTasks({ project, targetRepository, flagship });

  return {
    goal: input.goal || formatGoal({ project, selectedRoadmap, flagship, oneSentence }),
    items,
    notes: [
      targetRepository ? `Target repository: ${targetRepository}` : null,
      specVersion ? `Spec version: ${specVersion}` : null,
      flagship ? `Flagship v0 mission pack: ${flagship}` : null,
      oneSentence ? `Definition: ${oneSentence}` : null,
    ].filter(Boolean).join('\n'),
    projectKey: slugify(input.project_key || project),
    spec: {
      project,
      target_repository: targetRepository,
      spec_version: specVersion,
      flagship_v0_mission_pack: flagship,
      one_sentence_definition: oneSentence,
      roadmap,
    },
  };
}

function selectRoadmapPhases(roadmap, input = {}) {
  if (!roadmap.length) return [];
  if (input.include_all_phases === true || input.phase === 'all') return roadmap;
  if (input.phase) {
    const requested = String(input.phase).toLowerCase();
    const phase = roadmap.find(item => item.version.toLowerCase() === requested || item.title.toLowerCase() === requested);
    if (!phase) throw new Error(`unknown roadmap phase: ${input.phase}`);
    return [phase];
  }
  return [roadmap[0]];
}

function formatGoal({ project, selectedRoadmap, flagship, oneSentence }) {
  if (selectedRoadmap.length > 1) return `Build ${project} roadmap: ${selectedRoadmap.map(phase => phase.version).join(', ')}`;
  const phase = selectedRoadmap[0];
  return `Build ${project}${phase ? ` ${phase.version}` : ''}: ${phase?.title || flagship || oneSentence || 'formal spec implementation'}`;
}

function parseRoadmap(markdown) {
  const roadmapStart = markdown.search(/^##\s+29\.\s+Roadmap\s*$/mi);
  if (roadmapStart === -1) return [];
  const roadmapText = markdown.slice(roadmapStart);
  const phaseRe = /^###\s+(v\d+\.\d+)\s+[—-]\s+(.+)$/gmi;
  const matches = [...roadmapText.matchAll(phaseRe)];
  return matches.map((match, index) => {
    const start = match.index + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : roadmapText.length;
    const body = roadmapText.slice(start, end);
    return {
      version: match[1],
      title: match[2].trim(),
      deliverables: parseBulletsAfterLabel(body, 'Deliverables'),
      acceptance: parseBulletsAfterLabel(body, 'Acceptance'),
    };
  });
}

function parseBulletsAfterLabel(text, label) {
  const re = new RegExp(`${label}:\\s*\\n([\\s\\S]*?)(?:\\n###|\\n[A-Z][A-Za-z ]+:|$)`, 'i');
  const block = text.match(re)?.[1] || '';
  return block
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => /^[-*•]\s+/.test(line))
    .map(line => line.replace(/^[-*•]\s+/, '').trim())
    .filter(Boolean);
}

function roadmapTask(deliverable, { project, targetRepository, phase }) {
  const lower = deliverable.toLowerCase();
  const isCode = /(rust|cli|daemon|sqlite|parser|scheduler|api|dashboard|mcp|worker|router|gpu|crawler|verifier|state|artifact|event)/i.test(deliverable);
  const isOps = /(recovery|permissions|startup|enforce|view|pause|resume|cancel|crash|restart)/i.test(deliverable);
  return {
    title: `${phase.version}: ${deliverable}`,
    description: [
      `Project: ${project}`,
      targetRepository ? `Repository: ${targetRepository}` : null,
      `Roadmap section: ${phase.version} — ${phase.title}`,
      '',
      `Implement or prepare the deliverable: ${deliverable}`,
      phase.acceptance?.length ? `Phase acceptance:\n- ${phase.acceptance.join('\n- ')}` : null,
    ].filter(Boolean).join('\n'),
    owner: isCode ? 'code-agent' : isOps ? 'ops-agent' : 'strategy-agent',
    domain: isCode ? 'code' : isOps ? 'maintenance' : 'product',
    priority: lower.includes('dashboard') || lower.includes('tui') ? 'medium' : 'high',
    tags: ['formal-spec', 'roadmap', phase.version, slugify(project)],
    impact_score: 8,
    effort_score: lower.includes('basic') ? 3 : 5,
    autonomy_level: 2,
    risk_level: lower.includes('permissions') || lower.includes('daemon') ? 'medium' : 'low',
    quality_gate: 'implementation',
    acceptance: phase.acceptance?.length ? phase.acceptance.join(' ') : 'Pass relevant checks and produce a concise implementation note.',
  };
}

function defaultTasks({ project, targetRepository, flagship }) {
  return [
    {
      title: `Create implementation plan for ${project}`,
      description: [targetRepository ? `Repository: ${targetRepository}` : null, flagship ? `Flagship: ${flagship}` : null].filter(Boolean).join('\n'),
      owner: 'strategy-agent',
      domain: 'product',
      priority: 'high',
      tags: ['formal-spec', slugify(project)],
      effort_score: 2,
    },
  ];
}

function firstMatch(text, re) {
  const match = text.match(re);
  return match ? String(match[1]).trim() : '';
}

function slugify(value) {
  return String(value || 'formal-spec')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'formal-spec';
}

module.exports = { createFormalSpecPacket, listFormalSpecs, getFormalSpec, parseFormalSpec, parseRoadmap, selectRoadmapPhases };
