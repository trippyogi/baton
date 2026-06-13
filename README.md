# BATON

BATON is the human-touch layer for agent swarms.

It helps an operator keep valuable agent work in motion by answering:

- What should I touch next?
- Why now?
- What action sends this work back into motion?
- Can this touch be automated next time?

The primary daily surface is **Flow**: a ranked next-touch queue plus a command box. Existing overview, board, runs, queue, cost, memory, and diagnostics screens remain available as secondary views.

## Current build status

Implemented phases:

- **Next-Touch Engine stabilization pass**
  - Runs screen read endpoints and SSE stub.
  - Extension routes load before the SPA fallback.
  - Snoozed touches resurface after expiry; `passed` touches no longer suppress new generated touches.
  - Touch actions are authorized by touch type; non-review touches cannot be accepted as done.
  - Delegation/assignment is honest when no worker dispatcher exists: it prepares work but does not mark tasks/agents running.
  - Invalid review packets create evaluator/refinement touches; valid packets create review touches.
  - Flow command submit force-refreshes after action.
  - User-controlled text is escaped across Flow-adjacent task/board/run surfaces.
  - Task deletion is soft archive.
  - `GET /api/flow` is read-safe and preserves manual escalation boosts.
  - `idle agents` uses the real agent registry and assignment candidates avoid duplicate ready-task matches.
  - Tasks API accepts ranking/autonomy fields.
  - Webhook signature/payload handling is hardened.
  - `npm run check:js`, `npm run smoke`, `npm run audit`, and `npm test` scripts are available.

- **Phase 0 — Local app stabilization**
  - Declared missing `dotenv` and `ioredis` dependencies.
  - Fixed internal extension loading by importing `db` in `server/index.js`.
  - Redis-backed queue/webhook paths now degrade cleanly when Redis is unavailable during local development.

- **Phase 1 — Flow Home MVP**
  - New default route: `/#/flow`.
  - Mode selector and airspace strip.
  - Deterministic next-touch generation from existing tasks.
  - Ranked touch queue with explainable `why_now` strings.
  - Command box support for capture, delegate, mode changes, review-next, and “what needs me”.
  - Basic touch actions: accept, refine, delegate, answer, process, snooze, archive, inspect, escalate.
  - Board renamed into Flow language as the secondary Airspace Map.

- **Phase 2 — Review packet quality gate**
  - Review packet API and validation.
  - Valid packets create linked review touches.
  - Invalid packets are marked `needs_evaluator` and routed as refinement/evaluator work instead of normal human review.

- **Phase 3 — Agent capacity layer**
  - Seeded agent registry.
  - `/api/agents` endpoint.
  - Idle-agent counts in Flow airspace.
  - Idle-agent candidate generation against ready tasks.
  - Assigning an idle-agent touch moves the task airborne and marks the agent running.

## Product model

BATON treats the true unit of work as a **human touch**: a brief moment where human judgment, taste, context, approval, prioritization, or feedback unlocks more valuable agent motion.

Core concepts:

- **Task** — broader body of work.
- **Run** — one execution attempt by an agent.
- **BatonTouch** — ranked human touch required to keep work moving.
- **Airspace** — compact state of running, waiting, review, idle, stale, failed, ready, and inbox work.
- **Flow Mode** — current operator mode that changes ranking behavior.
- **Review Packet** — structured agent output required before human review.
- **Agent** — worker status/capacity record used for assignment.

## Flow modes

Supported modes:

- `deep_build`
- `triage`
- `review`
- `strategy_creative`
- `launch`
- `admin`
- `cleanup`
- `recovery`

Mode affects touch scoring and prioritization.

## Getting started

```bash
git clone https://github.com/trippyogi/baton.git
cd baton
npm install
cp .env.example .env
npm start
```

Default local URL:

```text
http://127.0.0.1:4200/#/flow
```

If port `4200` is already in use:

```bash
VMC_PORT=4420 npm start
```

Redis is optional for local Flow development. Queue diagnostics gracefully return empty queue data when Redis is unavailable.

## Checks

With a server already running:

```bash
npm run check:js
BATON_BASE_URL=http://127.0.0.1:4200 npm run smoke
npm run audit
```

`npm test` runs syntax checks and smoke checks. Set `BATON_BASE_URL` when the server is on a non-default port.

## API overview

Flow:

```text
GET   /api/flow
PATCH /api/flow/mode
POST  /api/flow/command
```

Touches:

```text
GET   /api/touches
POST  /api/touches/rebuild
PATCH /api/touches/:id/action
```

Agents:

```text
GET   /api/agents
GET   /api/agents/:id
PATCH /api/agents/:id
```

Review packets:

```text
GET  /api/review-packets
POST /api/review-packets
```

Existing routes remain available for tasks, runs, overview, queue, costs, performance, memory, team, shared requests, and creatives.

## Command box examples

```text
capture improve onboarding copy for MetaTravelers
idea make review packets mandatory before human review
delegate audit checkout funnel copy
mode launch
mode review
review next
triage
what needs my judgment?
idle agents
```

Unknown command text falls back to inbox capture.

## Review packet minimum

A valid review packet requires:

- `goal`
- `summary`
- `suggested_next_action`
- at least one `evidence` item
- `confidence_score`
- `quality_score`

Invalid packets are stored with `packet_status = needs_evaluator`.

## Extending BATON

Create `baton-internal/extension.js` alongside your baton directory:

```js
module.exports = {
  register(app, db) {
    app.get('/api/my-route', (req, res) => {
      res.json({ ok: true });
    });
  }
};
```

BATON detects and loads it at startup. It falls back gracefully if absent.

## License

MIT
