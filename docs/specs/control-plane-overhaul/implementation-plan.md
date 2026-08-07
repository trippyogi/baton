# Control-plane overhaul — Implementation plan

Status: Accepted  
V1 release gate: **Phase 4 complete**  
Deferred: Phases 5–6 → separate feature `batond-runtime`; Phase 7 Redis/hardening after v1

Rebaseline rule: before coding any phase, diff current `main` against this plan and skip already-satisfied deliverables. Do not re-stabilize finished work from the historical v1.1 Phase 0 list blindly.

---

## Phase overview

| Phase | Outcome | Safe stop | In v1? |
|---:|---|---|---|
| 0 | Repo authority + public/private constitution + baseline gap harden | Yes | Yes |
| 1 | Strict TypeScript API (Node 24) + contracts | Yes | Yes |
| 2 | Vanilla TS web + typed SDK | Yes | Yes |
| 3 | Canonical domain + DecisionRequest + BatonTouch + ranking | Yes | Yes |
| 4 | HTTP/Spectre dispatch, ACK, review/refinement, ranked queue, migration parity | **v1 release** | Yes |
| 5–6 | batond Linux runtime | Optional later | No |
| 7 | Redis / further hardening | Optional later | No |

---

## Phase 0 — Authority, boundary, baseline gaps

**Objective:** Prove `trippyogi/baton` is safe to evolve; enforce public/private boundary; close remaining honesty gaps vs current `main`.

### Hard gate (blocks Phase 1)

1. Document that `trippyogi/baton` is canonical.
2. Inventory and eliminate (or prove absent) parent/subtree/mirror overwrite paths (`vector-mission-control`, `baton-core`, sync scripts, submodule force-push workflows).
3. Build agent MUST report evidence that commits here cannot be silently overwritten by external sync.
4. Update README/CONTRIBUTING to supersede any parent-load topology language.

### Deliverables

- Public/private boundary checklist wired into CI (`audit:private` + docs); move remaining private/business-specific core leaks behind extension/local config.
- Gap analysis vs historical Phase 0 (many items already done on current main): only fix remaining defects.
- Confirm dependency/config/health/webhook/auth posture; repair residuals only.
- Capture reviewed baseline SHA for the overhaul branch.

### Exit

- Canonical-repo evidence recorded in `docs/specs/control-plane-overhaul/phase-0-evidence.md` (created during implementation).
- Public-safe audit green.
- App starts; existing smoke/dispatch checks green.
- **No TypeScript migration started before the hard gate passes.**

### Rollback

Revert Phase 0 PR.

---

## Phase 1 — TypeScript API foundation (Node 24)

**Objective:** Port server to strict TypeScript without changing product behavior.

### Deliverables

- Pin Node 24 across `.nvmrc`, `engines`, CI, docs (leave Node 20 behind).
- npm workspaces; `packages/contracts` with Zod + committed JSON Schema.
- Port API route-by-route; repositories around SQLite; typed config; structured errors/logging.
- Preserve root `npm start` shim and legacy response shapes.
- Express 5 only as a separate commit after Express 4 parity is green (optional within phase).

### Exit

- Server runtime is TypeScript; strict typecheck green; legacy API snapshots green.

### Rollback

Shim back to Phase 0 JS entrypoint.

---

## Phase 2 — TypeScript browser + SDK

**Objective:** Port browser to vanilla TS; Flow becomes a thin client over upcoming touch APIs (modes remain soft hints).

### Deliverables

- `apps/web` + Vite; typed SDK; incremental screen port.
- No React; no visual redesign beyond lifecycle badges needed for new states.
- Playwright smoke for critical navigation.

### Exit

- Browser app TypeScript; parity with pre-port screens; production build served from API.

---

## Phase 3 — Canonical domain + BatonTouch

**Objective:** Authoritative Task/Run/Dispatch/Review/Blocker/DecisionRequest model; BatonTouch projection; touch ranking.

### Deliverables

- Migrations + one-way legacy Flow status/touch migration tests (no fabricated ACKs/reviews).
- Transition services; terminal immutability; one active run; linear lineage; optimistic concurrency.
- DecisionRequest entity (small).
- `baton_touches` + idempotent projection service (same transaction as canonical writes).
- Touch ranking + persisted `why_now`; `workMode` soft hint only.
- `/api/v1` routes; legacy adapters for `/api/flow` and `/api/touches`.
- Adversarial state-transition tests (without requiring full dispatch yet).

### Exit

- No route mutates status via raw SQL.
- Touches always reference canonical source+version.
- Domain commands resolve touches; generic status PATCH cannot finish work.
- Migration fixtures green.

### Rollback

DB backup; feature-flag new writes; keep compatibility reads.

---

## Phase 4 — Dispatch, review loop, v1 release

**Objective:** Complete trustworthy control plane against existing agent runtimes.

### Deliverables

- DispatchEnvelope / Ack / RunEvent / Review / Block / Failure / Decision contracts.
- Transactional outbox + DispatchAttempt; Mock + HttpWebhook/Spectre adapters.
- ACK deadlines, callback credentials, refinement/retry children, blockers.
- Review UI + ranked touch queue wired end-to-end.
- Freeze batond contract fixtures/docs without implementing daemon.
- Deterministic demos; full adversarial loop-integrity suite.
- Compatibility parity tests; document shim-removal criteria.

### Exit (BATON v1)

End-to-end proof: ready → dispatch → ACK → running → valid review touch → decision → done; invalid output → refinement child; blockers/decisions/assignment touches behave; archive orthogonal; Redis/Rust not required.

### Shim removal criteria

Remove legacy `/api/flow` and legacy touch action shapes only when all are true:

1. `/api/v1/touches` and domain command APIs cover operator daily paths.
2. Compatibility parity suite green for two consecutive CI weeks (or explicit operator sign-off).
3. No in-repo client calls legacy mutation paths.
4. CHANGELOG documents the break; major/minor bump per SemVer policy.

### Rollback

`BATON_DISPATCH_ENABLED` off; reads remain.

---

## Phases 5–6 — batond-runtime (separate Spec Kit feature)

Only when measured pain: orphans, cancel/timeout unreliability, worktree collisions, recovery issues, meaningful concurrent workers.

- Linux-only process supervision.
- Control plane/browser stay portable.
- batond never owns touches/ranking/review.

## Phase 7 — Redis / hardening

After v1; optional adapter; never source of truth.

---

## Feature flags (indicative)

```text
BATON_V1_API_ENABLED
BATON_LEGACY_API_ENABLED
BATON_DISPATCH_ENABLED
BATON_REVIEW_ENABLED
BATON_BATOND_ENABLED=false  # v1
BATON_REDIS_ADAPTER_ENABLED=false
```

## Risk notes

| Risk | Mitigation |
|---|---|
| External sync overwrites baton | Phase 0 hard gate |
| Touch dual-truth | Constitution + command flow tests |
| Scope expands into Rust | V1 cut at Phase 4 |
| Compatibility forever | Explicit shim-removal criteria after Phase 4 |
| Node 24 native module friction | Pin and CI early in Phase 1 |
