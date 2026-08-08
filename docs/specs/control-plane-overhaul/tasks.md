# Control-plane overhaul — Tasks

Dependency-ordered work for Spec Kit implement. Checkboxes are the build contract; do not start a phase before the prior exit gate.

Normative references: `constitution.md` (`.specify/`), `spec.md`, `design.md`, `implementation-plan.md`.

---

## Phase 0 — Authority & boundary

- [x] **T0.1** Inventory sync/subtree/parent references (`vector-mission-control`, `baton-core`, scripts, CI, docs).
- [x] **T0.2** Prove or eliminate overwrite paths; write `phase-0-evidence.md` with findings.
- [x] **T0.3** Update README/CONTRIBUTING: `trippyogi/baton` canonical; supersede parent-load topology.
- [x] **T0.4** Diff current `main` vs historical v1.1 Phase 0; list only residual gaps.
- [x] **T0.5** Enforce public/private boundary in CI/docs; quarantine remaining private core leaks.
- [x] **T0.6** Fix residual baseline defects only (extension missing-vs-broken; generic README examples).
- [x] **T0.7** Ensure `npm test`, `smoke:dispatch`, `audit`, `audit:private` green.
- [x] **T0.8** Phase 0 review packet / exit gate — **hard stop before TS port**.

## Phase 1 — TypeScript API (Node 24)

- [x] **T1.1** Pin Node 24 (`.nvmrc`, `engines`, CI, docs); verify `better-sqlite3` build.
- [x] **T1.2** Create workspaces: `apps/api`, `packages/contracts`, `packages/sdk` (stub ok).
- [x] **T1.3** Zod schemas + committed JSON Schema generation for config (legacy API shapes next).
- [x] **T1.4** Typed config validation in `@baton/contracts` (runtime bootstrap keeps a CJS-safe port/host check; Zod stays out of the native SQLite process on Windows).
- [x] **T1.5** Repository layer; remove raw SQL from new route modules as they port. *(partial: `createApp`/`startServer` extraction)*
- [x] **T1.6** Port routes incrementally with snapshot/parity tests. *(in progress: health, overview, agents, alerts, runs, tasks, builds)*
- [x] **T1.7** Structured errors, request IDs, redacted logging. *(request-id + error middleware scaffolded; redacted logging still open)*
- [x] **T1.8** Root `npm start` compatibility shim (`apps/api/bootstrap.cjs`).
- [ ] **T1.9** (Optional isolated) Express 5 upgrade after 4 parity.
- [ ] **T1.10** Phase 1 exit gate.

## Phase 2 — TypeScript web

- [ ] **T2.1** Vite `apps/web` vanilla TS.
- [ ] **T2.2** Typed SDK for fetch/SSE.
- [ ] **T2.3** Port screens; Flow UI as thin queue client (modes = soft hints).
- [ ] **T2.4** Lifecycle badge affordances for future dispatch states.
- [ ] **T2.5** Playwright smoke.
- [ ] **T2.6** Phase 2 exit gate.

## Phase 3 — Canonical domain + BatonTouch

- [ ] **T3.1** DB migrations for Task/Run/Dispatch/DispatchAttempt/Event/Artifact/Review/Blocker/DecisionRequest.
- [ ] **T3.2** `baton_touches` table + indexes + unique `dedupe_key`.
- [ ] **T3.3** Transition services + invariants (terminal immutability, one active run, linear lineage, versions).
- [ ] **T3.4** DecisionRequest CRUD + status machine (small).
- [ ] **T3.5** Idempotent touch projection service (create/update/resolve/supersede/cancel).
- [ ] **T3.6** Touch ranking service + persisted `why_now` / `openedSnapshot`.
- [ ] **T3.7** `/api/v1` domain + touch attention endpoints (no generic resolve-via-PATCH).
- [ ] **T3.8** Legacy Flow/touch adapters (read/compatibility); one-way data migration tests.
- [ ] **T3.9** Adversarial domain/touch tests.
- [ ] **T3.10** Phase 3 exit gate.

## Phase 4 — Dispatch + v1 release

- [ ] **T4.1** Contract package: dispatch, ack, events, review, block, failure, decision.
- [ ] **T4.2** Outbox + DispatchAttempt + Mock + Http/Spectre adapters.
- [ ] **T4.3** ACK/callback security, deadlines, sweeper, idempotency.
- [ ] **T4.4** Completion validation → review touch / invalid_output refinement / blockers.
- [ ] **T4.5** Review/blocker/decision command paths resolve touches transactionally.
- [ ] **T4.6** Ranked touch queue UI wired to v1 APIs.
- [ ] **T4.7** Freeze batond contract fixtures/docs (no daemon implementation).
- [ ] **T4.8** Demos: happy path + refinement; Redis/Rust not required.
- [ ] **T4.9** Full adversarial loop-integrity suite + compatibility parity report.
- [ ] **T4.10** Document shim-removal criteria; **declare BATON v1**.
- [ ] **T4.11** Phase 4 exit gate / release review packet.

## Deferred — batond-runtime (new Spec Kit feature later)

- [ ] **TD.1** Open `batond-runtime` feature only after measured execution pain.
- [ ] **TD.2** Linux-only supervisor per frozen Phase 4 contracts.

## Parallelizable notes

- Within a phase, contract fixtures and tests can proceed in parallel with implementation once schemas are sketched.
- Do not parallelize Phase 0 hard gate with Phase 1.
- Do not start Phase 5 tasks under this feature.
