'use strict';
const express = require('express');
const router  = express.Router();

const AGENTS = [
  {
    id:         '1473837171055263785',
    name:       'Vector',
    emoji:      '🧭',
    role:       'Primary Orchestrator / Product Owner',
    description: 'Strategic partner, executes builds, manages analytics, content, research, and scheduling. Product decisions, creative direction, business context.',
    workspace:  '/home/ubuntu/clawd',
    sessionKey: 'agent:main:discord:channel:1465111349578436609',
    model:      'claude-sonnet-4-6',
    status:     'online',
    channel:    'discord',
  },
  {
    id:         '1474534966770532415',
    name:       'Circuit',
    emoji:      '⚡',
    role:       'Lead Systems Architect / Developer',
    description: 'API design, backend architecture, frontend structure, refactoring, debug strategy, test design. Receives tasks from Vector, returns structured implementation plans and code.',
    workspace:  '/home/ubuntu/circuit',
    sessionKey: 'agent:circuit:discord:channel:1465111349578436609',
    model:      'claude-sonnet-4-6',
    status:     'online',
    channel:    'discord',
  },
];

router.get('/', (_req, res) => {
  res.json({ agents: AGENTS });
});

module.exports = router;
