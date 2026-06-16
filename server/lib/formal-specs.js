'use strict';

const { createStrategyPacket } = require('./strategy-packets');

function createFormalSpecPacket(db, input = {}) {
  const markdown = String(input.markdown || input.body || input.raw_input || '').trim();
  if (!markdown) throw new Error('markdown is required');

  const parsed = parseFormalSpec(markdown, input);
  return {
    spec: parsed.spec,
    ...createStrategyPacket(db, {
      goal: parsed.goal,
      items: parsed.items,
      notes: parsed.notes,
      created_by: input.created_by || 'formal-spec-intake',
      project_key: parsed.projectKey,
    }),
  };
}

function parseFormalSpec(markdown, input = {}) {
  const project = firstMatch(markdown, /^\*\*Project:\*\*\s*(.+)$/mi) || input.project || 'Formal Spec';
  const targetRepository = firstMatch(markdown, /^\*\*Target repository:\*\*\s*`?([^`\n]+)`?$/mi) || input.target_repository || '';
  const specVersion = firstMatch(markdown, /^\*\*Spec version:\*\*\s*(.+)$/mi) || input.spec_version || '';
  const flagship = firstMatch(markdown, /^\*\*Flagship v0 mission pack:\*\*\s*(.+)$/mi) || '';
  const oneSentence = firstMatch(markdown, /^###\s+1\.1\s+One-sentence definition\s+\n+\*\*(.+?)\*\*/mis) || '';
  const roadmap = parseRoadmap(markdown);
  const firstRoadmap = roadmap[0];
  const items = firstRoadmap?.deliverables?.length
    ? firstRoadmap.deliverables.map(deliverable => roadmapTask(deliverable, { project, targetRepository, phase: firstRoadmap }))
    : defaultTasks({ project, targetRepository, flagship });

  return {
    goal: input.goal || `Build ${project}${firstRoadmap ? ` ${firstRoadmap.version}` : ''}: ${firstRoadmap?.title || flagship || oneSentence || 'formal spec implementation'}`,
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

module.exports = { createFormalSpecPacket, parseFormalSpec, parseRoadmap };
