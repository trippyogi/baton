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
  - Assigning an idle-agent touch prepares the handoff. Until a dispatcher is configured, BATON does not mark the task airborne or the agent running.

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
nvm use
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

BATON is pinned to Node 20 via `.nvmrc`; `package.json` supports Node `>=20 <23`.

## Versioning

BATON follows Semantic Versioning.

Current version: `0.1.0`.

Because BATON is still pre-1.0, minor versions may include breaking changes while the Next-Touch Engine stabilizes. Patch versions should be reserved for compatible fixes. Release notes should be recorded in `CHANGELOG.md`.

Recommended release flow:

1. update `package.json` version
2. update `CHANGELOG.md`
3. run checks/audit
4. commit as `release: vX.Y.Z`
5. tag with `vX.Y.Z`
6. push commit and tag

## Security

See `SECURITY.md` for supported versions, vulnerability reporting, and the release security checklist.

Key defaults:

- `.env`, local DB files, logs, and secrets are ignored and should never be committed.
- Webhooks validate HMAC signatures before doing work.
- User-controlled UI output is escaped.
- Touch actions are authorized by type.
- Delegation/assignment is currently prepared-only unless dispatch is configured; it does not mark tasks airborne or agents running.
- `npm run audit` should pass before release tags.

## Checks

```bash
npm test
npm run audit
```

`npm test` runs syntax checks and a self-contained smoke test. The smoke test starts BATON on a temporary port with an isolated SQLite database unless `BATON_BASE_URL` is set.

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

## Contributing

See `CONTRIBUTING.md` for local setup, product invariants, PR checklist, and security expectations.

## Changelog

See `CHANGELOG.md`.

## License

MIT — see `LICENSE`.
