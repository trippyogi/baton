# BATON Constitution

Status: Accepted  
Applies to: all work on `trippyogi/baton`  
Feature scope: Phases 0–4 (`control-plane-overhaul`); later `batond-runtime`

This constitution is the highest-priority Spec Kit artifact. Specs, designs, tasks, and code MUST NOT violate it.

---

## 1. Product identity

BATON is a **human-attention control plane** for agent work.

- Canonical workflow truth lives in Task, Run, Dispatch, ReviewPacket, ReviewDecision, TaskBlocker, DecisionRequest, and Artifact.
- The primary product surface is the ranked **BatonTouch** queue: durable requests for human attention.
- BATON does not replace reasoning agents (OpenClaw, Hermes, Spectre, etc.).
- A future Linux `batond` execution runtime is optional infrastructure, not the product.

## 2. Source of truth and repository authority

- **`trippyogi/baton` is the canonical repository.**
- Any parent/subtree/mirror overwrite path MUST be eliminated or proven absent before TypeScript migration begins (Phase 0 gate).
- Historical claims that BATON is loaded from a parent `vector-mission-control` / `baton-core` tree are superseded.
- Spec Kit artifacts in this repo are authoritative over frozen design inputs under `docs/specs/_inputs/`.

## 3. Public / private boundary

Architectural invariant, enforced from Phase 0:

| Public core owns | Must stay outside public core |
|---|---|
| Generic control-plane contracts | Personal/business credentials |
| Domain model and APIs | Private host paths and account IDs |
| Demo fixtures and OSS docs | Company-specific prompts/integrations |
| Extension *interfaces* | Operator SQLite data and local profiles |

Private operator use is first-class. Private data lives in ignored local files / local DB. CI MUST fail on public-safe violations.

## 4. Authority boundaries

| Concern | Owner |
|---|---|
| Objective, priority inputs, acceptance criteria | Task |
| Execution attempt lifecycle | Run |
| Delivery and retries | Dispatch / DispatchAttempt |
| Reviewable output | ReviewPacket |
| Approve / request changes / reject | ReviewDecision |
| Missing info / permission / dependency | TaskBlocker |
| Open-ended human decision | DecisionRequest |
| Artifacts | Artifact |
| Request for human attention | BatonTouch |
| Seen, snooze, assignee, escalation, rank override | BatonTouch |
| Process spawn, leases, worktrees (when used) | batond (later) |
| Business priority / ranking policy | BATON TypeScript |

Workers and `batond` report facts. They do not write BATON's authoritative database.

## 5. BatonTouch rule

A BatonTouch is a **durable materialized attention projection**:

- First-class in product, API, ranking queue, and database.
- Points at a canonical source + source version.
- Owns only attention lifecycle state.
- NEVER independently owns task, run, review, blocker, or decision truth.
- Domain commands update canonical entities first; touches resolve in the same transaction.
- Generic `PATCH touch.status = resolved` is forbidden.

## 6. Lifecycle integrity

- Terminal run states are immutable; retries/refinements create child runs.
- Run lineage is **linear** for v1 (one parent → at most one direct child).
- Transport delivery is not agent ACK; `running` requires persisted ACK.
- Invalid agent output becomes refinement/failure handling, not human review.
- Human review receives only schema- and semantically-valid review packets.
- Delivery is at-least-once; handling is idempotent.
- Exactly one non-terminal active run per task.

## 7. Ranking rule

- Rank **BatonTouch**, not Task.
- Task impact/urgency/effort are inputs to touch ranking.
- `why_now` explanations are deterministic, persisted, and inspectable.
- Flow **work modes** are nullable soft hints that may bias rank/UI defaults. They MUST NOT become workflow state or override lifecycle rules.

## 8. Local path stays boring

- Core demo: Node + SQLite + mock/Spectre-compatible HTTP agent. No Redis or Rust required for v1.
- Default bind `127.0.0.1`. Non-loopback bind without auth MUST fail startup.
- Solo operator first: no `tenant_id` / multi-tenant schema in v1.

## 9. Contracts precede transport

- Versioned JSON contracts are the source of truth across HTTP, Redis, file, or future adapters.
- HTTP/webhook is the reference transport for v1.
- Redis is optional and never the control-plane source of truth.
- Freeze `batond` contracts during Phase 4; implement the daemon only when measured execution pain justifies it.

## 10. Migration and rollback

- Compatibility window, not a breaking cutover.
- One-way migration + compatibility reads/endpoints; avoid prolonged dual-write.
- Remove compatibility only after Phases 3–4 parity and migration tests pass.
- Never roll back by editing terminal records.

## 11. V1 cut line

**BATON v1 ends at Phase 4.**

Phases 5–6 (`batond`) and Phase 7 (Redis/hardening) are a separate later Spec Kit feature. They MUST NOT block the control-plane release.

## 12. Build discipline

- Implement one phase at a time; stop at exit gates with evidence.
- Prefer Spec Kit clarify → plan → tasks → implement → converge over ad-hoc mega-prompts.
- Normative language: MUST / SHOULD / MAY as in the historical design input.
