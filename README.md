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

- **Formal Spec Intake MVP**
  - `POST /api/formal-specs/parse` extracts project metadata, target repository, one-sentence definition, and roadmap phases from a Markdown formal spec.
  - `POST /api/formal-specs` converts roadmap deliverables into a BATON strategy packet plus ready tasks, preserving the target repo and acceptance criteria in task descriptions.
  - Supports default first-phase intake, explicit `phase` selection, or `include_all_phases` for full-roadmap task generation.
  - Adds a `/#/specs` operator screen for pasting a Markdown spec, previewing generated tasks, and creating the packet/tasks from the UI.

- **Next-Touch Engine stabilization pass**
  - Runs screen read endpoints and SSE stub.
  - Extension routes load before the SPA fallback.
  - Snoozed touches resurface after expiry; `passed` touches no longer suppress new generated touches.
  - Touch actions are authorized by touch type; non-review touches cannot be accepted as done.
  - Delegation/assignment is truthful: configured agents dispatch through a run lifecycle; unconfigured agents remain visible and do not fake motion.
  - Invalid review packets create evaluator/refinement touches; valid packets create review touches.
  - Flow command submit force-refreshes after action.
  - User-controlled text is escaped across Flow-adjacent task/board/run surfaces.
  - Task deletion is soft archive.
  - `GET /api/flow` is read-safe and preserves manual escalation boosts.
  - `idle agents` uses the real agent registry and assignment candidates avoid duplicate ready-task matches.
  - Tasks API accepts ranking/autonomy fields.
  - Webhook signature/payload handling is hardened.
  - `npm run check:js`, `npm run smoke`, `npm run smoke:dispatch`, `npm run smoke:nectar`, `npm run audit`, and `npm test` scripts are available.

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
  - Assigning an idle-agent touch creates a dispatch run when the agent has configured transport. BATON marks agents running only after ACK.


- **Spectre webhook dispatch v1**
  - Spectre is seeded as the first real dispatch-capable orchestrator agent.
  - `delegate Spectre ...` creates a Spectre-owned ready task and one assignment touch.
  - Prepare/Assign creates a run, sends a compact `baton.dispatch.v1` envelope by webhook, waits for ACK, then marks the run/agent/task in motion.
  - Spectre review packets advance runs to `review_ready`; accepting the review completes the task and run.
  - `npm run fake:spectre` and `npm run smoke:dispatch` exercise the full local loop.

- **Local Nectar dispatch bridge**
  - `npm run bridge:nectar` starts a private local bridge at `/baton/dispatch` for `baton.dispatch.v1` handoffs to Nectar.
  - The bridge ACKs and writes ignored inbox records under `local/nectar-dispatch-inbox/`; it does not execute external actions by itself.
  - It rejects malformed JSON and oversized bodies before inbox writes, with `NECTAR_BRIDGE_MAX_BODY_BYTES` available only for explicit local overrides.
  - `/health` supports GET and HEAD probes and exposes `bind_host`, `dispatch_path`, `started_at`, `uptime_seconds`, `received_count`, `rejected_count`, `inbox_record_count`, `inbox_writable`, `last_received_at`, `last_inbox_path`, `last_rejected_at`, `last_rejection_reason`, and `max_body_bytes` for smoke/debug checks.
  - `npm run smoke:nectar` exercises the bridge and public-safe Nectar fixture.

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

For private same-tailnet development, bind to a specific private interface instead of all interfaces and set an API bearer token:

```bash
BATON_HOST=100.x.y.z VMC_PORT=4200 BATON_API_TOKEN=replace-with-a-long-random-token npm start
```

Keep the default `127.0.0.1` for ordinary local development. Non-localhost API routes require `BATON_API_TOKEN` and expect `Authorization: Bearer <token>`; `/api/health` remains open for readiness checks. Do not bind BATON to `0.0.0.0` unless you also have strict network restrictions.

Redis is optional for local Flow development. Queue diagnostics gracefully return empty queue data when Redis is unavailable.

### Private local use

BATON is safe to run with your own tasks and agents locally. Keep private data in ignored `local/` files or the local SQLite DB, then use `npm run audit:private` before committing. See `docs/guides/private-local-use.md`.

The Requests screen is optional and token-protected; set `SHARED_REQUESTS_TOKEN` in `.env` to enable it locally.

BATON is pinned to Node 20 via `.nvmrc`; `package.json` supports Node `>=20 <21` because `better-sqlite3` is a native dependency.

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
- Delegation/assignment only marks tasks airborne and agents running after configured dispatch ACKs. Unconfigured dispatch remains visible and honest.
- `npm run audit` and `npm run audit:private` should pass before release tags.

## Checks

```bash
npm test
npm run smoke:dispatch
npm run smoke:nectar
npm run audit
npm run audit:private
npm run check:private
```

`npm test` runs syntax checks and a self-contained Flow smoke test. `npm run smoke:dispatch` starts BATON plus a fake Spectre webhook on isolated temp state and verifies the dispatch/review loop. `npm run smoke:nectar` verifies Baton can hand a `baton.dispatch.v1` envelope to the local Nectar bridge and write an ignored inbox record. `npm run audit:private` checks that private local data and high-signal secrets are not tracked. `npm run check:private` combines that audit with dry-runs of the public-safe local profile fixtures for the private/local agent workflow.

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
POST  /api/agents
GET   /api/agents/:id
PATCH /api/agents/:id
```

Task dispatch prep:

```text
POST /api/tasks/:id/dispatch/prepare
```

Review packets:

```text
GET  /api/review-packets
POST /api/review-packets
```

Dispatch:

```text
POST /api/dispatch/test
POST /api/runs/:id/ack
POST /api/runs/:id/status
```

Existing routes remain available for tasks, runs, overview, queue, costs, performance, memory, team, shared requests, and creatives.

## Command box examples

```text
capture improve onboarding copy for the demo launch
idea make review packets mandatory before human review
delegate audit checkout funnel copy
delegate Spectre review the demo launch plan
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
