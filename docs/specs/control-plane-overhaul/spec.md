# Control-plane overhaul — Product specification

Status: Accepted (clarified)  
Feature: `control-plane-overhaul`  
Baseline: `main` @ `2adc35b` (revalidated at implementation start)  
V1 release: end of Phase 4  
Deferred feature: `batond-runtime` (Phases 5–6+)

This document defines **what** BATON v1 must be and **why**. Implementation detail lives in `design.md` and `implementation-plan.md`.

---

## 1. Problem

Solo operators running agent swarms need a trustworthy place to answer:

1. What needs my attention **now**?
2. **Why** now?
3. What exact action unlocks the next agent motion?
4. Can I trust that delivery, ACK, review, and retries are honest?

Today BATON already has Flow/touches, review packets, and Spectre HTTP dispatch, but workflow truth, attention state, and API shapes are tangled. Without a clean control plane, BATON drifts into either a fragile task dashboard or a dual-write mess between touches and runs.

## 2. Vision

BATON v1 is a **TypeScript control plane** with:

- Canonical Task / Run / Dispatch / Review / Blocker / DecisionRequest / Artifact state
- A ranked **BatonTouch** queue as the primary human product surface
- Hardened HTTP/Spectre dispatch with real ACK and refinement loops
- A public-safe core and private local operator boundary
- Compatibility shims so existing UI/API consumers keep working during migration

Rust `batond` is **out of v1**. Contracts may be frozen so it can attach later.

## 3. Actors

| Actor | Needs |
|---|---|
| Solo operator (primary) | Ranked attention queue; review/blocker/decision actions; local private data; loopback-safe defaults |
| Reasoning agent (Spectre/Hermes/OpenClaw/mock) | Versioned dispatch envelopes; ACK/start/completion callbacks; no fabricated running state |
| OSS contributor | Generic demo without Redis/Rust/private data |
| Future `batond` (non-v1) | Frozen execution contracts; no ownership of ranking or review |

## 4. Goals

1. One authoritative workflow model with enforced transitions and immutable terminal runs.
2. BatonTouch as durable attention projection with stable IDs for queue, audit, and actions.
3. Rank touches (not tasks) with persisted deterministic `why_now`.
4. Real ACK before `running`; invalid output never enters human review.
5. Linear run lineage for retries/refinement.
6. DecisionRequest as canonical source for `decision_required` touches.
7. Hardened HTTP/Spectre dispatch path as the reference transport.
8. Public/private boundary enforced in Phase 0 and constitution.
9. TypeScript control plane + typed browser/SDK with Node 24.
10. Compatibility window for legacy Flow API/UI shapes.
11. Complete local demo without Redis or Rust.
12. Confirm `trippyogi/baton` cannot be overwritten by external sync before TS migration.

## 5. Non-goals (v1)

- `batond` process supervisor or Rust workspace as a release requirement
- Redis as required transport
- Multi-tenant / `tenant_id` / SaaS auth/billing
- React/Vue/Svelte rewrite
- Postgres before measured SQLite pain
- MCP or gRPC as primary dispatch
- Notification delivery system (Discord/email) — stub only; future `TouchDelivery` entity
- Windows/macOS process-supervision parity for `batond`
- Flow modes as workflow state machines
- Prolonged dual-write between legacy and canonical stores

## 6. User stories

### US1 — Ranked attention queue

As the operator, I open BATON and see only actionable BatonTouches, ordered by explainable rank, including snoozed items that resurface when due.

**Acceptance**

- Queue lists open (and due-from-snooze) touches only.
- Each item shows kind, summary, rank score, and `why_now` factors.
- Touch IDs are stable across reloads.
- Modes may bias ranking modestly; they do not hide required review/blocker work.

### US2 — Review without garbage

As the operator, I only see review touches backed by validated ReviewPackets.

**Acceptance**

- Invalid completions create refinement/failure handling, not review touches.
- Approve / request_changes / reject go through ReviewDecision APIs with `touchId` + expected versions.
- Request changes creates exactly one child refinement run (linear lineage).
- Matching review touch resolves in the same transaction.

### US3 — Blockers and decisions

As the operator, missing credentials/permissions become blocker touches; open-ended choices become decision touches backed by DecisionRequest.

**Acceptance**

- Resolving a blocker or responding to a decision updates the canonical entity first, then the touch.
- No generic “dismiss touch” that leaves canonical work unfinished.

### US4 — Honest dispatch

As the operator, assigning work to Spectre/HTTP agents shows delivered → acknowledged → running as distinct milestones.

**Acceptance**

- Transport 200/202 is not ACK.
- Unconfigured agents remain visible and do not fake motion.
- ACK timeout and lost-lease paths follow policy with at most one retry child when allowed.

### US5 — Private local use

As the operator, I run real private tasks locally without leaking them into the public repo.

**Acceptance**

- Public fixtures are generic.
- Private paths/credentials live in ignored local config.
- Public-safe audit fails CI on violations.

### US6 — Migration without a cliff

As the operator, existing Flow screens and legacy endpoints keep working during the overhaul.

**Acceptance**

- One-way migration of Flow statuses/touches into canonical model.
- Compatibility adapters preserve legacy shapes until Phases 3–4 parity tests pass.
- No prolonged dual-write of authoritative state.

### US7 — Boring local demo

As a contributor, I run `npm ci` / demo scripts with Node + SQLite only.

**Acceptance**

- Redis optional.
- Rust not required.
- Deterministic demo reaches “awaiting human review” via mock or fake Spectre.

## 7. Product entities (conceptual)

| Entity | Role |
|---|---|
| Task | Intended work; objective; criteria; priority inputs |
| Run | One immutable execution attempt; linear children for retry/refine |
| Dispatch / DispatchAttempt | Logical handoff + concrete delivery attempts |
| ReviewPacket / ReviewDecision | Validated output + human judgment |
| TaskBlocker | Structured reason work cannot proceed |
| DecisionRequest | First-class open-ended decision source |
| Artifact | Registered output metadata |
| BatonTouch | Durable ranked request for human attention |
| workMode (optional hint) | Soft ranking/UI bias only |

## 8. BatonTouch kinds (v1)

| Kind | Canonical source |
|---|---|
| `review_required` | ReviewPacket |
| `blocker_resolution_required` | TaskBlocker |
| `decision_required` | DecisionRequest |
| `assignment_required` | Task assignment gap |
| `prioritization_required` | Task prioritization need (rare) |
| `capture_triage_required` | Triage Task (raw capture becomes a task first) |

**Actions are not kinds:** approve, refine, archive, delegate, reprioritize are commands on canonical entities or attention endpoints.

**Touch statuses:** `open` | `snoozed` | `resolved` | `superseded` | `cancelled`

## 9. Success metrics for v1

- Adversarial loop-integrity suite green (ACK, invalid output, lineage, idempotency).
- Touch queue is the operator’s daily surface; Flow is a thin UI over touches (modes demoted).
- Spectre/HTTP dispatch path trustworthy without Rust.
- Public-safe audit + private local guide green.
- Legacy compatibility tests green until shim removal criteria met.

## 10. Out of scope signals (defer)

If work starts looking like notification transport schema on BatonTouch, multi-tenant IDs, React rewrite, or Linux process-tree supervisor — stop and route to a later feature/ADR.
