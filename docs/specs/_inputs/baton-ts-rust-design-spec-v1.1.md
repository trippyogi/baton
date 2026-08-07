# BATON TypeScript Control Plane + Rust Execution Runtime

**Design specification and implementation roadmap**  
**Status:** Implementation-ready  
**Spec version:** 1.1  
**Prepared:** 2026-08-07  
**Target repository:** `trippyogi/baton`  
**Reviewed baseline:** `main` at `4f25198d831d9ad0c9cd14ddb1fd712e077aeb2f`  
**Primary audience:** Build agent, code reviewer, future maintainers  
**Review pass:** Architecture, lifecycle, migration, security, and rollback consistency reviewed before handoff

---

## 0. How to use this specification

This document is the governing build contract for the BATON migration. The build agent should implement it one phase at a time, stop at every exit gate, and return evidence before proceeding.

Normative language:

- **MUST** means the implementation is not acceptable without it.
- **SHOULD** means the default decision unless repository evidence requires a documented exception.
- **MAY** means optional and must not block the current phase.

The build agent must not treat later phases as permission to broaden the current phase. Every phase is intentionally scoped so BATON remains usable throughout the migration.

---

## 1. Executive decision

BATON should become a **TypeScript control plane** with an optional **Rust execution runtime** named `batond`.

```text
OpenClaw / Hermes / Spectre
(reasoning, planning, orchestration)
              │
              │ resolved work instructions
              ▼
BATON — TypeScript control plane
(tasks, ranking, dispatch lifecycle, audit, human review)
              │
              │ versioned JSON contracts
              ▼
batond — Rust execution supervisor
(processes, leases, cancellation, worktrees, logs, artifacts)
```

The boundaries are deliberate:

- BATON does **not** replace OpenClaw, Hermes, Spectre, or another reasoning agent.
- `batond` does **not** plan work, choose goals, rank tasks, select business priorities, or approve output.
- TypeScript remains the best fit for CRUD, JSON APIs, integrations, browser code, extension logic, and human review.
- Rust is introduced only where deterministic process control, concurrency, filesystem safety, cleanup, cancellation, and crash recovery justify it.
- HTTP/webhook dispatch is the reference transport. Redis Streams remains an optional adapter, not the source of truth.
- SQLite remains the authoritative BATON database until real multi-user or write-concurrency pressure proves otherwise.
- The existing browser UI stays framework-free during this roadmap. Port it to TypeScript; do not rewrite it in React.

### Final target

> **BATON = human-centered agent operations control plane**  
> **OpenClaw/Hermes = reasoning and orchestration**  
> **batond = narrow, deterministic execution runtime**

---

## 2. Design review conclusions

The initial TypeScript/Rust direction was sound, but a production-grade design needs several corrections.

### Improvements incorporated into this specification

1. **Add a stabilization phase before the port.** The current repository contains missing runtime dependencies, hidden extension failures, inconsistent states, hard-coded deployment details, and private business-specific data in the public core.
2. **Separate task state, run state, and dispatch state.** The current schema mixes queue, execution, and review concerns. This makes invariants impossible to enforce cleanly.
3. **Require a real agent ACK before `running`.** Transport delivery is not agent acceptance.
4. **Keep malformed agent output out of the human review queue.** Invalid completion output becomes automated refinement work. Only a validated review packet can create a review item.
5. **Make terminal states immutable.** Retries and refinements create child runs; they never reopen a terminal run.
6. **Use HTTP/webhooks first.** This supports OpenClaw, Hermes, Discord-adjacent workflows, VPN-separated workers, local machines, and future transports without making Redis mandatory.
7. **Keep BATON authoritative.** `batond` may persist local operational state for crash recovery, but it does not write BATON's SQLite database directly.
8. **Avoid full event sourcing.** BATON gets an append-only event log for audit and replay diagnostics while retaining normal materialized state tables.
9. **Keep Rust narrow.** The Rust runtime starts only after the TypeScript lifecycle is proven end to end.
10. **Use TypeScript 6 for the initial migration.** TypeScript 7 is newly available but still has ecosystem/API transition constraints. BATON should first land on the stable, broadly compatible TypeScript 6 toolchain and evaluate TypeScript 7 after the migration is green.
11. **Make archive status orthogonal.** Archiving hides a task without rewriting its execution outcome. `archived_at` is metadata, not a TaskStatus.
12. **Separate logical dispatch from delivery attempts.** One Dispatch keeps a stable identity and idempotency key; every HTTP/Redis send is recorded as a DispatchAttempt.
13. **Persist blockers and restricted diagnostics explicitly.** BlockPackets, exhausted automation, and invalid-output evidence must not be buried in generic logs.
14. **Define callback credentials out of band.** Callback secrets are delivered in transport headers or a secure side channel, never persisted inside the JSON envelope.
15. **Target Linux first for process supervision.** Phase 6 guarantees process-tree and worktree behavior on Linux; other operating systems are best-effort until separately accepted.

---

## 3. Goals and non-goals

### 3.1 Goals

The migration must deliver:

1. Strict TypeScript across the API and browser code.
2. Runtime validation for every external payload.
3. Explicit task, run, dispatch, review, and artifact contracts.
4. Enforced state transitions with immutable terminal states.
5. A real dispatch acknowledgment protocol.
6. A human review gate that receives only validated review packets.
7. Automatic refinement for malformed or semantically incomplete agent output.
8. Explainable task ranking with a persisted `why_now` breakdown.
9. Transport-neutral dispatch adapters.
10. A clean local demo that does not require Redis or Rust.
11. A public-safe core with no personal IDs, private paths, business tokens, account IDs, or company-specific seed data.
12. A typed extension system for private integrations.
13. A Rust runtime that can safely supervise processes, leases, cancellation, worktrees, logs, and artifacts.
14. Cross-language contract tests so TypeScript and Rust cannot drift silently.
15. A reversible rollout with compatibility shims for the current API and parent application.
16. Exactly one active run per task, enforced by the database and domain service.
17. Optimistic concurrency on human/API mutations so stale clients cannot overwrite newer state.
18. A durable distinction between logical dispatch state and individual transport delivery attempts.

### 3.2 Non-goals

This roadmap does not include:

- A full Rust rewrite of BATON.
- Replacing OpenClaw, Hermes, Spectre, or any orchestration agent.
- Autonomous business prioritization by `batond`.
- A React, Vue, Svelte, or other frontend framework rewrite.
- Kubernetes, Temporal, NATS, Kafka, or a service mesh.
- Postgres before SQLite becomes a measured constraint.
- Multi-tenant SaaS authentication or billing.
- MCP as the primary dispatch transport.
- gRPC as a required dependency.
- A generalized plugin marketplace.
- A container sandbox in the first Rust phase.
- Direct Rust access to BATON's authoritative control-plane database.
- Visual redesign beyond what is needed to expose the new lifecycle and review states.

---

## 4. Current repository audit

### 4.1 Current architecture

The reviewed repository is a small Node/Express application with:

- Express API routes.
- SQLite through `better-sqlite3`.
- Redis Streams inspection through `ioredis`.
- Vanilla browser ES modules.
- Server-Sent Events helper code.
- A dynamic internal extension loader.
- GitHub webhook logic that creates fix jobs.
- Hard-coded operational integrations for Meta ads, local memory files, creatives, and team agents.

This is a good candidate for incremental migration. It is not large enough to justify a big-bang rewrite.

### 4.2 Defects and architectural debt to resolve before or during Phase 0

| Severity | Area | Finding | Required treatment |
|---|---|---|---|
| P0 | Repository source of truth | The current README describes this repo as `baton-core` loaded and synchronized from a parent `vector-mission-control` repository. Editing only the public mirror may be overwritten by the existing sync path. | Phase 0 must document the canonical source, sync direction, and release path. Implement in the canonical source and regenerate/sync the mirror; never maintain two divergent copies manually. |
| P0 | Extension loading | `server/index.js` calls `ext.register(app, db)` without importing `db`. The broad `try/catch` hides the failure and reports that no extension is present. | Import dependencies explicitly. Only ignore a true optional-module-not-found error. Fail startup on extension initialization errors. |
| P0 | Public/private boundary | The public core contains hard-coded names, Discord IDs, session keys, host paths, account behavior, and ExampleCorp-specific seed data. | Move private behavior into a typed extension or external configuration. Replace seeds with generic fixtures. Add an automated public-safe audit. |
| P0 | State integrity | Run and task updates are direct SQL mutations without a transition service. Terminal states can be overwritten. `running` has no ACK requirement. | Introduce canonical state machines and require all mutations through domain services. |
| P1 | Dependencies | `package.json` does not declare every imported runtime package, including `dotenv` and `ioredis`. | Reconcile imports against dependencies and make `npm ci` the required install path. |
| P1 | Frontend/API contract drift | The Runs screen calls `GET /api/runs`, `GET /api/runs/:id`, and `/api/runs/stream`; the reviewed Runs router implements only POST and PATCH. Overview also opens the missing run stream. | Inventory every browser request, add the missing read/SSE routes or intentionally remove the unsupported UI behavior, and lock parity with contract tests before porting. |
| P1 | Configuration | `.env.example` defines `PORT`, while the server reads `VMC_PORT`. The host and SSH destination are hard-coded. | Adopt a validated configuration schema with one canonical variable name. Remove deployment-specific logs. |
| P1 | Status drift | The code uses `pending`, `running`, `completed`, and `success` inconsistently. Queue metrics count `success` while seeds use `completed`. | Normalize statuses and provide a legacy mapping migration. |
| P1 | Queue semantics | The Redis queue screen infers undelivered work from consumer-group delivery IDs. It conflates queued, pending, claimed, and running jobs. | Replace inference with BATON dispatch/run state. Redis becomes transport telemetry only. |
| P1 | Webhook safety | HMAC comparison can throw on unequal-length inputs; delivery replay is not deduplicated; payload shape is assumed; callback work is not idempotent. | Add length-safe constant-time comparison, delivery-ID dedupe, schema validation, idempotency, and explicit event handling. |
| P1 | Job execution | `server/routes/handleJob.js` is an incomplete fragment with undefined dependencies and no exported router or service. | Delete it after preserving any useful intent. Replace execution with the adapter contract and later `batond`. |
| P1 | Authentication | Most write routes rely on loopback binding rather than an explicit exposure policy. | Keep loopback as the safe default; fail startup if binding externally without an auth mode. |
| P2 | Health reporting | Agent count, online status, and gateway status are hard-coded. | Derive health from endpoint heartbeats and configured agents. |
| P2 | Integration errors | Some integration routes return HTTP 200 with `{ error: true }`. | Use consistent typed error responses and appropriate HTTP status codes. |
| P2 | Filesystem coupling | Memory and creative routes use absolute host paths. | Move paths to extension config and validate them against allowed roots. |
| P2 | Testing | There is no meaningful automated test baseline or transition-integrity suite. | Add unit, integration, contract, end-to-end, and adversarial tests before feature expansion. |

### 4.3 Existing behavior to preserve

The migration should preserve:

- The current task board and core screens.
- The lightweight browser experience.
- SQLite as a local-first store.
- The extension concept.
- GitHub webhook-driven repair workflows, after hardening.
- Existing root commands and parent-application integration through compatibility shims.
- Existing API response shapes until the new frontend has cut over.
- Human visibility into tasks, runs, costs, logs, artifacts, and queue state.

---

## 5. Architectural principles

### 5.1 The control plane is authoritative

BATON owns:

- Task intent and acceptance criteria.
- Rank and `why_now` explanation.
- Run creation and lineage.
- Dispatch lifecycle.
- Human review state.
- Review decisions.
- Audit events.
- Artifact metadata.
- Policy and budget limits.

Workers and `batond` report facts. They do not directly mutate BATON state.

### 5.2 Reasoning stays outside the runtime

OpenClaw, Hermes, Spectre, or another reasoning agent may:

- Expand rough work into an actionable specification.
- Choose an agent profile.
- Select tools or models.
- Create a DispatchEnvelope.
- Interpret business context.

`batond` may only:

- Validate resolved instructions.
- Accept or reject an execution request.
- Spawn an approved executor.
- Enforce runtime policy.
- Stream logs and heartbeats.
- Stop, time out, or clean up work.
- Register artifacts.
- Return structured completion facts.

### 5.3 Contracts precede transport

Every transport carries the same versioned contracts. HTTP, Redis, file queues, Discord bridges, and MCP are adapters—not separate job models.

### 5.4 Delivery is at-least-once; handling is idempotent

BATON must assume a dispatch, ACK, callback, or webhook may arrive more than once. Every external mutation requires an idempotency key or unique event ID.

### 5.5 Human attention is gated

Human review is scarce. The human review queue must never contain:

- Invalid JSON.
- A packet for the wrong run.
- Missing required artifacts.
- Failed required acceptance criteria unless policy explicitly allows known gaps.
- An unstructured stack trace.
- A malformed model response.

Those conditions become refinement or failure handling, not review work.

### 5.6 Terminal states are immutable

A terminal run never reopens. Retry, repair, or refinement creates a new child run linked to its parent.

### 5.7 Keep the local path boring

A new contributor must be able to run BATON with Node, SQLite, and the included mock agent. Redis and Rust are optional until their respective phases.

---

## 6. Target architecture

```text
┌─────────────────────────────────────────────────────────────────────┐
│                         Reasoning layer                             │
│         OpenClaw / Hermes / Spectre / human operator               │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ prepare / assign
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                 BATON control plane — TypeScript                   │
│                                                                     │
│  Web UI          API             Domain services       Extensions   │
│  ──────          ───             ───────────────       ──────────   │
│  Board           Tasks           State machines        GitHub       │
│  Runs            Runs            Ranking / why_now      Memory       │
│  Review queue    Dispatches      Review validation     Business      │
│  Timeline        Events          Refinement policy     integrations  │
│                                                                     │
│                 SQLite authoritative state                          │
└───────────────────────┬───────────────────────────┬─────────────────┘
                        │ HTTP reference adapter     │ optional adapters
                        ▼                            ▼
              ┌──────────────────┐         ┌──────────────────────┐
              │ Agent endpoint   │         │ Redis / file / MCP   │
              │ or mock worker   │         │ transport adapters   │
              └────────┬─────────┘         └──────────────────────┘
                       │ optional deterministic execution
                       ▼
              ┌────────────────────────────────────┐
              │             batond                 │
              │       Rust execution runtime       │
              │                                    │
              │ lease persistence   process tree   │
              │ heartbeats          cancellation   │
              │ worktrees           log streaming  │
              │ artifacts           cleanup        │
              └────────────────────────────────────┘
```

### 6.1 Responsibility matrix

| Capability | BATON TypeScript | OpenClaw/Hermes/Spectre | batond Rust |
|---|---:|---:|---:|
| Business priority | Owns persisted rank | May propose inputs | Never |
| `why_now` explanation | Owns deterministic result | May suggest evidence | Never |
| Task specification | Stores and validates | Produces/refines | Receives final form only |
| Agent selection | Stores selection | May decide | Never |
| Dispatch lifecycle | Owns | Initiates through BATON | ACKs accepted dispatch |
| Process spawn | Never | External agents may self-run | Owns when used |
| Worktree lifecycle | Never | May operate externally | Owns when used |
| Logs/artifacts | Stores metadata and streams | Produces | Captures/registers |
| Human review | Owns | Never approves | Never approves |
| Retry/refinement policy | Owns | May supply new instructions | Executes new child run |
| Control-plane database | Owns | No direct access | No direct access |

---

## 7. Repository structure

### 7.1 Final target

```text
baton/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── config/
│   │   │   ├── domain/
│   │   │   ├── repositories/
│   │   │   ├── routes/
│   │   │   ├── services/
│   │   │   ├── adapters/
│   │   │   ├── extensions/
│   │   │   └── server.ts
│   │   └── test/
│   └── web/
│       ├── src/
│       │   ├── api/
│       │   ├── components/
│       │   ├── screens/
│       │   └── app.ts
│       └── public/
├── packages/
│   ├── contracts/
│   │   ├── src/
│   │   ├── schemas/
│   │   └── fixtures/
│   ├── sdk/
│   └── test-support/
├── crates/
│   ├── batond/
│   └── baton-contract-tests/
├── db/
│   ├── migrations/
│   └── fixtures/
├── extensions/
│   └── example/
├── scripts/
│   ├── migrate/
│   ├── public-safe-audit/
│   └── demo/
├── docs/
│   ├── adr/
│   ├── api/
│   └── operations/
├── package.json
├── Cargo.toml
├── rust-toolchain.toml
└── docker-compose.yml
```

### 7.2 Migration rule

Do not move every file at once.

- Phase 0 repairs the current layout.
- Phase 1 creates workspaces and ports the API route-by-route.
- Phase 2 moves browser code.
- Root shims preserve `npm start` and current import paths until cutover.
- The old `server/` and `public/js/` directories are removed only after compatibility tests prove no parent consumer depends on them.

---

## 8. Technology choices

### 8.1 TypeScript control plane

| Area | Choice | Rationale |
|---|---|---|
| Runtime | Node.js 24 LTS | Production LTS baseline with modern platform APIs. Pin through `.nvmrc` or equivalent. |
| Language | TypeScript 6.x | Stable migration target with broad tooling compatibility. Evaluate TypeScript 7 after the codebase is green. |
| Modules | ESM with `moduleResolution: nodenext` for API; bundler resolution for web | Matches modern Node and Vite without deprecated resolution behavior. |
| API framework | Express 4 during mechanical port, then Express 5 in an isolated sub-step | Avoids changing language and framework behavior at the same moment. |
| Validation | Zod schemas with generated, committed JSON Schema | One TypeScript source for runtime validation and cross-language schema artifacts. |
| Database | `better-sqlite3` behind repositories | Preserve proven local behavior; remove raw SQL from routes. |
| Web build | Vite + vanilla TypeScript | Type-safe browser code without a framework rewrite. |
| Tests | Vitest + Supertest + Playwright for critical UI flows | Fast unit/integration coverage and targeted end-to-end validation. |
| Logging | Pino-compatible structured JSON logging | Correlation IDs, redaction, and operational readability. |
| Formatting/linting | One pinned formatter/linter configuration | Exact tool may be selected in Phase 1, but CI must be deterministic. |

### 8.2 Rust runtime

| Area | Choice | Rationale |
|---|---|---|
| Toolchain | Rust 1.97.1, edition 2024 | Current stable baseline at spec time; pin with `rust-toolchain.toml`. |
| Async runtime | Tokio 1.x | Process, signal, networking, and cancellation support. |
| HTTP | Axum | Small typed HTTP boundary for dispatch, health, cancel, and status. |
| Serialization | Serde | Stable contract mapping. |
| Local runtime state | `rusqlite` | Simple crash-recovery store without coupling to BATON's database. |
| Logging | `tracing` | Structured spans correlated by task, run, dispatch, and worker IDs. |
| Errors | Typed error enums with redacted public messages | Prevent arbitrary internal errors from leaking into callbacks. |

### 8.3 Version policy

- Pin exact versions in lockfiles.
- Automated dependency update PRs are allowed only after the migration phases are complete.
- Do not adopt TypeScript 7 during Phase 1 unless the full lint, test, editor, schema-generation, and Vite toolchain is proven compatible in the same PR.
- Rust patch upgrades may be accepted when CI remains green and the pinned toolchain is updated intentionally.

---

## 9. Domain model

### 9.1 Entity overview

| Entity | Purpose |
|---|---|
| `Task` | Human or agent-authored unit of intended work. |
| `TaskDependency` | Explicit prerequisite relation between tasks. |
| `Run` | One immutable execution attempt for a task. |
| `Dispatch` | One logical handoff for a run, with a stable ID and idempotency key. |
| `DispatchAttempt` | One concrete HTTP, Redis, or other transport send for a Dispatch. |
| `RunEvent` | Append-only fact received or produced during a run. |
| `ReviewPacket` | Validated, structured output eligible for human review. |
| `ReviewDecision` | Human approve, request changes, or reject action. |
| `TaskBlocker` | Structured reason work cannot proceed, with resolution state. |
| `RunDiagnostic` | Restricted, size-limited evidence for invalid or failed output. |
| `Artifact` | Registered output with provenance and integrity metadata. |
| `AgentEndpoint` | Configured dispatch target and adapter type. |
| `RankExplanation` | Persisted score and deterministic `why_now` factors. |

### 9.2 Identifier rules

- IDs MUST be globally unique UUIDs.
- External event IDs MUST be unique within their source.
- A run MUST reference exactly one task.
- A child run MUST reference its parent run and increment `attempt_number`. Run lineage is linear: one parent may have at most one child. Parallel work is represented by separate tasks, not sibling runs.
- A task MUST have at most one non-terminal active run.
- A dispatch MUST reference exactly one run.
- A dispatch attempt MUST reference exactly one dispatch.
- A validated review packet MUST be unique per completed run.
- Human/API writes MUST carry an expected entity version or equivalent conditional request token.

### 9.3 Task

```ts
export interface AcceptanceCriterion {
  id: string
  description: string
  required: boolean
}

export interface Task {
  id: string
  title: string
  objective: string
  status: TaskStatus
  currentRunId: string | null
  ownerId: string | null
  tags: string[]
  acceptanceCriteria: AcceptanceCriterion[]
  dueAt: string | null
  impact: number
  urgency: number
  confidence: number
  effort: number
  manualBoost: number
  rankScore: number
  whyNow: RankExplanation
  version: number
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}
```

Archive is an orthogonal visibility/lifecycle flag:

- `archivedAt = null` means visible in normal work views.
- Setting `archivedAt` does not change `status`.
- Active tasks may not be archived; they must first reach `done` or `cancelled`, or be explicitly cancelled in the same command.
- Unarchiving restores visibility but never reopens a terminal status.
- `currentRunId` points to the newest run in the task's active lineage. It may reference a terminal completed run while the task is in `human_review`.
- The presence of an active run is determined by RunStatus and the one-active-run constraint, not by `currentRunId` alone.

### 9.4 Run

A run is an immutable execution attempt. It may accumulate events while active, but once terminal its status and result identity cannot change. Its `inputSnapshot` freezes the task version, objective, acceptance criteria, tags, and prepared context used for execution and result validation.

```ts
export interface RunInputSnapshot {
  taskVersion: number
  title: string
  objective: string
  tags: string[]
  acceptanceCriteria: AcceptanceCriterion[]
  preparedContext: Record<string, unknown>
  capturedAt: string
}

export interface RunPolicy {
  timeoutSeconds: number
  ackTimeoutSeconds: number
  heartbeatIntervalSeconds: number
  leaseTimeoutSeconds: number
  cancelGraceSeconds: number
  maxExecutionRetries: number
  maxRefinementRuns: number
  maxCostUsd: number | null
  requireHumanApproval: boolean
}

export interface Run {
  id: string
  taskId: string
  parentRunId: string | null
  attemptNumber: number
  kind: 'execute' | 'refine' | 'repair' | 'retry'
  status: RunStatus
  resultKind: 'review' | 'blocked' | 'failure' | null
  agentEndpointId: string
  agentRunId: string | null
  currentDispatchId: string | null
  policy: RunPolicy
  inputSnapshot: RunInputSnapshot
  acknowledgedAt: string | null
  startedAt: string | null
  endedAt: string | null
  failureCode: string | null
  costUsd: number
  tokenUsage: Record<string, number>
  version: number
  createdAt: string
  updatedAt: string
}
```

### 9.5 Dispatch and delivery attempt

```ts
export interface Dispatch {
  id: string
  runId: string
  endpointId: string
  adapterType: string
  status: DispatchStatus
  idempotencyKey: string
  attemptCount: number
  nextAttemptAt: string | null
  deliveredAt: string | null
  ackDeadlineAt: string | null
  acknowledgedAt: string | null
  version: number
  createdAt: string
  updatedAt: string
}

export interface DispatchAttempt {
  attemptId: string
  dispatchId: string
  attemptNumber: number
  status: 'started' | 'accepted' | 'retryable_error' | 'permanent_error'
  requestId: string
  startedAt: string
  endedAt: string | null
  transportStatus: number | string | null
  errorCode: string | null
}
```

`Dispatch.attemptCount` is a transactionally maintained materialized count and must equal the highest persisted attempt number. Attempt records are append-only.

### 9.6 Artifact

Artifacts are metadata records, not arbitrary paths pasted into a review packet.

```ts
export interface Artifact {
  id: string
  runId: string
  kind: 'file' | 'diff' | 'commit' | 'pull_request' | 'report' | 'log' | 'url'
  label: string
  uri: string
  sha256: string | null
  sizeBytes: number | null
  mediaType: string | null
  createdAt: string
}
```

Absolute local paths MUST NOT be exposed directly to the browser. A local file should be registered and served through a controlled BATON artifact endpoint or represented by a safe workspace-relative path.

### 9.7 Agent endpoint

```ts
export interface AgentEndpoint {
  id: string
  name: string
  adapterType: 'mock' | 'http' | 'batond-http' | 'redis-stream'
  enabled: boolean
  baseUrl: string | null
  capabilityCodes: string[]
  supportedContractIds: string[]
  authRef: string | null
  config: Record<string, unknown>
  lastHeartbeatAt: string | null
  version: number
}
```

Endpoint URLs and auth references are operator configuration. A task or DispatchEnvelope cannot override them.

---

## 10. State machines

### 10.1 Task states

```ts
export type TaskStatus =
  | 'triage'
  | 'ready'
  | 'in_progress'
  | 'blocked'
  | 'human_review'
  | 'done'
  | 'cancelled'
```

```text
triage ───────────────► ready
                         │
                         ▼
                    in_progress ◄──────────────┐
                         │                      │
                         ├── valid BlockPacket ─► blocked
                         │                      │
                         ├── valid ReviewPacket ► human_review
                         │                      │
                         │                      ├── request changes
                         │                      │
                         │                      └── approve ─► done
                         │
                         └──────────────────────► cancelled
```

Rules:

- `done` and `cancelled` are terminal execution states.
- `archived_at` is orthogonal metadata and is not a TaskStatus.
- `blocked` requires a persisted TaskBlocker created from a valid BlockPacket, an exhausted retry/refinement policy, or an explicit human action.
- `human_review` requires a persisted, schema-valid, semantically valid ReviewPacket.
- A malformed completion packet cannot transition a task to `human_review`.
- A human `request_changes` decision returns the task to `in_progress` and creates exactly one child refinement run.
- Resolving a blocker moves the task to `ready` when dependencies and required inputs are satisfied; otherwise it remains `blocked`.
- A task may not have more than one non-terminal active run.
- An active task may not be archived. Archive/unarchive changes visibility only and never reopens work.

### 10.2 Run states

```ts
export type RunStatus =
  | 'pending_dispatch'
  | 'dispatching'
  | 'dispatched'
  | 'acknowledged'
  | 'running'
  | 'validating_result'
  | 'cancelling'
  | 'completed'
  | 'blocked'
  | 'invalid_output'
  | 'dispatch_failed'
  | 'failed'
  | 'lost'
  | 'timed_out'
  | 'cancelled'
```

Terminal run states:

```text
completed
blocked
invalid_output
dispatch_failed
failed
lost
timed_out
cancelled
```

Canonical flow:

```text
pending_dispatch
      │
      ▼
dispatching
      │ transport accepted delivery
      ▼
dispatched
      │ real agent DispatchAck
      ▼
acknowledged
      │ run.started event from same agent_run_id
      ▼
running
      │ completion received
      ▼
validating_result
      ├── valid ReviewPacket ─► completed
      ├── valid BlockPacket  ─► blocked
      ├── valid FailurePacket► failed
      └── invalid packet     ─► invalid_output
```

Cancellation flow:

```text
pending_dispatch / dispatching / dispatched / acknowledged / running
                              │ cancel requested
                              ▼
                          cancelling
                              ├── worker confirms stop ─► cancelled
                              └── deadline expires     ─► timed_out
```

Once completion validation has begun, cancellation does not interrupt validation. The first valid terminal transition committed by the domain service wins; later events are audit-only.

### 10.3 Hard invariants

1. A run MUST NOT transition to `running` without a persisted DispatchAck.
2. A transport-level `200`, `202`, Redis `XADD`, or message enqueue is not an ACK.
3. An ACK MUST include `dispatch_id`, `run_id`, `agent_run_id`, `worker_id`, and `accepted_at`.
4. `run.started` MUST match the acknowledged `agent_run_id`.
5. A task MUST have at most one non-terminal active run. Enforce this in both the domain service and a database constraint/index.
6. A terminal run MUST reject all state-changing events except idempotent duplicates of already persisted events.
7. A stale event from an older run MAY be stored for audit but MUST NOT change the task state if a newer active child run exists.
8. An invalid completion packet MUST terminally mark the current run `invalid_output` and, when policy allows, create exactly one child refinement run.
9. A retry MUST create a new run. It must never set a terminal run back to `pending_dispatch`.
10. Every accepted transition MUST write a RunEvent in the same transaction as the materialized state update.
11. Direct route-level SQL state mutation is forbidden.
12. Human/API commands MUST compare the expected entity version and return 409 on stale writes.
13. Agent completion is submitted only through the completion endpoint. BATON writes the canonical `run.completion_submitted` event transactionally; the agent does not send a duplicate event separately.
14. Task archive/unarchive operations MUST NOT change TaskStatus or active-run lineage.
15. DispatchEnvelope generation and completion validation MUST use the immutable RunInputSnapshot, never mutable current task fields.
16. Objective, acceptance criteria, dependencies, and prepared execution context cannot be edited while a non-terminal run exists. Metadata-only fields may be changed with optimistic concurrency.

### 10.4 Dispatch states

A Dispatch is a logical handoff with a stable `dispatch_id` and idempotency key. It may have multiple DispatchAttempts when transport delivery is retried.

```ts
export type DispatchStatus =
  | 'queued'
  | 'sending'
  | 'delivered'
  | 'acknowledged'
  | 'retry_wait'
  | 'ack_timed_out'
  | 'failed'
  | 'cancelled'
  | 'superseded'
```

```text
queued ─► sending ─► delivered ─► acknowledged
   ▲          │            │
   │          ├─ retryable ─► retry_wait ─┘
   │          └─ permanent ─► failed
   │
   └──────────────── retry due

delivered ── ACK deadline expires ─► ack_timed_out
```

Rules:

- Every concrete send creates a DispatchAttempt row with timing, status, and sanitized error data.
- Retries reuse the same logical `dispatch_id` and idempotency key; they do not create another run.
- A new Dispatch row is created only when the run is intentionally re-targeted or a child retry run is created.
- A delivered dispatch may be acknowledged once. Duplicate equivalent ACKs are idempotent.
- `ack_timed_out`, `failed`, `cancelled`, and `superseded` are terminal dispatch states.
- The UI shows transport delivery, logical ACK, and run start as separate milestones.

### 10.5 Legacy status mapping

Task migration:

| Legacy | New |
|---|---|
| `inbox` | `triage` |
| `backlog` | `triage` |
| `ready` | `ready` |
| `in_progress` | `in_progress` |
| `waiting` | `blocked` with a migration-generated blocker record |
| `review` | `human_review` only when a valid review record can be constructed; otherwise `blocked` with migration note |
| `done` | `done` |
| `archived` | `triage` plus `archived_at`; preserve the original row in `legacy_payload_json` because the prior execution state is unknown |

Legacy field mapping:

- `description` becomes `objective`.
- `tags` remains a parsed string array; malformed JSON becomes an empty array plus migration diagnostic.
- `due_at` becomes `dueAt`.
- `impact_score` and `effort_score` are clamped to 0–10.
- Legacy priority maps to urgency: `critical=10`, `high=8`, `medium=5`, `low=2`.
- Confidence defaults to `5` unless extension data provides a better value.
- Legacy owner strings are preserved as configured owner IDs where valid; otherwise they become `null` with migration metadata.

Run migration:

| Legacy | New |
|---|---|
| `pending` | `pending_dispatch` |
| `completed` or `success` | `completed` with `result_kind = review` only when a valid historical result can be reconstructed; otherwise `completed` with migration note |
| `failed` | `failed` |
| `running` without historical ACK | `lost` with `failure_code = legacy_unacknowledged_run` |

The migration MUST NOT fabricate ACK history, review evidence, artifact integrity, or prior task state.

### 10.6 Outcome-to-task side effects

All rows below are applied transactionally with their events and any child-run creation.

| Trigger | Current run outcome | Task outcome | `current_run_id` | Additional record |
|---|---|---|---|---|
| Valid ReviewPacket | `completed`, result `review` | `human_review` | Remains current completed run | ReviewPacket |
| Valid BlockPacket | `blocked`, result `blocked` | `blocked` | Remains current blocked run | Open TaskBlocker |
| Retryable FailurePacket with budget | `failed`, result `failure` | `in_progress` | New retry child | RunDiagnostic |
| Non-retryable/exhausted failure | `failed`, result `failure` | `blocked` | Remains failed run | Open TaskBlocker + diagnostic |
| Invalid completion with budget | `invalid_output` | `in_progress` | New refinement child | RunDiagnostic |
| Invalid completion exhausted | `invalid_output` | `blocked` | Remains invalid run | Open TaskBlocker + diagnostic |
| Lease loss with retry budget | `lost` | `in_progress` | New retry child | RunDiagnostic |
| Lease loss exhausted | `lost` | `blocked` | Remains lost run | Open TaskBlocker + diagnostic |
| Human request changes | Prior run remains `completed` | `in_progress` | New refinement child | ReviewDecision |
| Human approve | Prior run remains `completed` | `done` | Remains approved run | ReviewDecision |
| Human reject | Prior run remains `completed` | `cancelled` | Remains reviewed run | ReviewDecision |

When a child is created, setting the parent terminal state, inserting the child, and moving `tasks.current_run_id` to the child occur in one transaction. A crash cannot leave the task pointing at a terminal parent while an unreferenced child exists.

---

## 11. Explainable ranking and `why_now`

BATON is a human-attention ranking system. Ranking must be deterministic, inspectable, and versioned.

### 11.1 Inputs

Each task stores integer values from 0 to 10:

- `impact`
- `urgency`
- `confidence`
- `effort`

Readiness is computed:

- `10` when all dependencies are complete.
- `0` when any dependency is incomplete.

`manual_boost` is an explicit operator override from 0 to 20. It must be visible in the explanation.

### 11.2 Rank formula v1

```text
raw_score =
  impact    * 4
+ urgency   * 3
+ readiness * 2
+ confidence
- effort
+ manual_boost

rank_score = clamp(raw_score, 0, 120)
```

Default ordering:

1. Highest `rank_score`.
2. Earliest due date.
3. Oldest creation time.
4. Stable task ID tie-breaker.

### 11.3 Persisted explanation

```ts
export interface RankExplanation {
  algorithmVersion: 'rank-v1'
  score: number
  calculatedAt: string
  factors: Array<{
    code: 'impact' | 'urgency' | 'readiness' | 'confidence' | 'effort' | 'manual_boost'
    value: number
    weight: number
    contribution: number
    evidence: string
  }>
  blockedReasons: string[]
  summary: string
}
```

The summary is deterministic template output, not an LLM-generated explanation. Example:

> High impact and urgent; all dependencies are complete. Moderate effort reduces the score by 4 points. Manually boosted by 10 points.

### 11.4 UI requirements

- Every ranked task card shows `rank_score`.
- Clicking the score opens the full `why_now` factor breakdown.
- Manual boosts are visually distinct.
- Blocked dependencies are listed.
- The queue must never show an unexplained opaque score.

---

## 12. Versioned contracts

### 12.1 Naming

Contract identifiers use:

```text
baton.<contract-name>.v<major>
```

Examples:

- `baton.dispatch.v1`
- `baton.dispatch-ack.v1`
- `baton.run-event.v1`
- `baton.review.v1`
- `baton.block.v1`
- `baton.failure.v1`
- `baton.review-decision.v1`

Every AgentEndpoint declares supported contract IDs. BATON must fail dispatch with a typed `unsupported_contract_version` error before delivery when no compatible major exists.

Contract schemas are closed by default. Any field-level wire-shape change outside an explicitly namespaced `extensions` object requires a new major contract identifier because old consumers reject unknown fields. Documentation changes, internal validation changes that do not alter the wire shape, and new namespaced extension entries do not change the identifier. Multiple major versions may coexist during a compatibility window.

Implementation requirements:

- Generated JSON Schemas set `additionalProperties: false` at closed object boundaries.
- Rust wire structs use `#[serde(deny_unknown_fields)]` at the same boundaries.
- TypeScript runtime parsers reject unknown fields rather than silently stripping them.
- Extension keys are reverse-domain or organization namespaced, such as `io.trippyogi.gitworthy`.
- Extensions may not weaken core validation, carry secrets, or redefine lifecycle fields.

### 12.2 DispatchEnvelope v1

```json
{
  "schema_version": "baton.dispatch.v1",
  "dispatch_id": "uuid",
  "run_id": "uuid",
  "task_id": "uuid",
  "attempt_number": 1,
  "kind": "execute",
  "created_at": "2026-08-07T00:00:00.000Z",
  "idempotency_key": "task-id:run-id:dispatch-v1",
  "target": {
    "agent_endpoint_id": "spectre-local",
    "required_capabilities": ["git", "typescript"]
  },
  "work": {
    "task_version": 7,
    "title": "Port task routes to TypeScript",
    "objective": "Preserve API behavior while introducing strict types",
    "acceptance_criteria": [
      {
        "id": "ac-1",
        "description": "Existing task API contract tests pass",
        "required": true
      }
    ],
    "context": {
      "repository": "trippyogi/baton",
      "base_ref": "main",
      "workspace_hint": "baton"
    },
    "deliverables": ["code", "tests", "implementation_notes"]
  },
  "policy": {
    "timeout_seconds": 1800,
    "ack_timeout_seconds": 30,
    "heartbeat_interval_seconds": 15,
    "lease_timeout_seconds": 60,
    "cancel_grace_seconds": 10,
    "max_execution_retries": 1,
    "max_refinement_runs": 2,
    "max_cost_usd": 5,
    "network_policy": "configured_adapter_default",
    "require_human_approval": true
  },
  "callback": {
    "ack_url": "https://baton.local/api/v1/dispatches/uuid/ack",
    "event_url": "https://baton.local/api/v1/runs/uuid/events",
    "completion_url": "https://baton.local/api/v1/runs/uuid/completion",
    "auth_mode": "per_dispatch_bearer",
    "credential_ref": "dispatch-callback-token:uuid"
  },
  "lineage": {
    "parent_run_id": null,
    "review_decision_id": null
  },
  "extensions": {}
}
```

Rules:

- No raw secret values in the envelope.
- `credential_ref` is an opaque identifier for BATON's audit/configuration. The adapter sends the actual short-lived callback bearer credential out of band, normally in an authenticated delivery header. The receiver must keep it out of logs and use it only for the URLs in this envelope.
- Unknown top-level fields are rejected in v1. Additive transport/domain metadata must live under the namespaced `extensions` object or use a new contract major.
- Payload size limit: 256 KB before compression.
- Acceptance-criterion IDs remain stable across refinement runs.
- `work` is generated from the persisted RunInputSnapshot. Later edits to the Task cannot change an already-created envelope.
- Time policy values are bounded by operator-configured minima/maxima; a task cannot request an unlimited lease, timeout, cost, or retry count.
- A DispatchEnvelope cannot override the configured endpoint URL, endpoint auth, executor command, or workspace root.

### 12.3 DispatchAck v1

```json
{
  "schema_version": "baton.dispatch-ack.v1",
  "dispatch_id": "uuid",
  "run_id": "uuid",
  "agent_run_id": "external-or-batond-run-id",
  "worker_id": "worker-instance-id",
  "accepted_at": "2026-08-07T00:00:01.000Z",
  "lease_id": "uuid",
  "lease_expires_at": "2026-08-07T00:01:01.000Z",
  "capabilities": ["git", "typescript"]
}
```

An ACK is valid only when:

- The dispatch exists and is `sending` or `delivered`, or is already `acknowledged` with the same ACK identity.
- `run_id` matches the dispatch.
- The callback credential is scoped to that dispatch and is unexpired.
- `agent_run_id` has not been used by another run for that endpoint.
- The run is non-terminal.
- `lease_id` is non-empty and unique for the active endpoint/run pair.
- BATON computes the effective lease expiry from trusted `received_at` plus policy; the worker-provided timestamp is recorded for diagnostics but cannot lengthen policy.

### 12.4 RunEvent v1

```json
{
  "schema_version": "baton.run-event.v1",
  "event_id": "uuid",
  "run_id": "uuid",
  "agent_run_id": "external-or-batond-run-id",
  "source": "worker",
  "sequence": 4,
  "type": "run.heartbeat",
  "occurred_at": "2026-08-07T00:00:20.000Z",
  "payload": {
    "lease_id": "uuid",
    "progress": {
      "phase": "tests",
      "message": "Running integration suite"
    }
  }
}
```

Worker-sent event types:

- `run.started`
- `run.heartbeat`
- `run.log_chunk`
- `run.artifact_registered`
- `run.cancel_acknowledged`

BATON-created event types include:

- `run.created`
- `dispatch.queued`
- `dispatch.delivered`
- `dispatch.acknowledged`
- `run.completion_submitted`
- `run.output_invalid`
- `run.terminal`

Event sequencing rules:

- Worker sequences are strictly increasing per `(run_id, source)`.
- An exact duplicate event is idempotent.
- A lower sequence with a different event ID is rejected as stale.
- A gap may be accepted and flagged for diagnosis; state-changing events still must satisfy the current-state invariant.
- BATON records both `occurred_at` and trusted server `received_at` and does not rely on worker clocks for ordering.

### 12.5 Completion packet union

An agent completes through exactly one valid packet kind:

```ts
export type AgentCompletionPacket =
  | ReviewPacketV1
  | BlockPacketV1
  | FailurePacketV1
```

#### ReviewPacket v1

```json
{
  "schema_version": "baton.review.v1",
  "packet_id": "uuid",
  "run_id": "uuid",
  "task_id": "uuid",
  "submitted_at": "2026-08-07T00:10:00.000Z",
  "summary": "Ported the task API and preserved the legacy response shape.",
  "acceptance_criteria": [
    {
      "id": "ac-1",
      "status": "pass",
      "evidence": "tests/api/tasks.contract.test.ts: all cases pass"
    }
  ],
  "checks": [
    {
      "name": "npm test",
      "status": "pass",
      "details": "42 tests passed"
    }
  ],
  "artifacts": [
    {
      "artifact_id": "uuid",
      "label": "Implementation notes"
    }
  ],
  "risks": [],
  "known_gaps": [],
  "recommended_decision": "approve"
}
```

Default semantic validity requires:

- Correct `run_id` and `task_id`.
- All required acceptance criteria present exactly once.
- Every required criterion is `pass`, unless the run policy explicitly allows known gaps.
- Required deliverables have registered artifacts.
- Referenced artifacts belong to the same run.
- No unresolved placeholder sentinels in required textual fields. The minimum deterministic sentinel set is `TODO`, `TBD`, `FIXME`, `<placeholder>`, and an exact value of `...`; extension validators may add domain-specific sentinels.
- Packet size is within limit.
- `recommended_decision` is advisory only and never applies a human decision automatically.

#### BlockPacket v1

```json
{
  "schema_version": "baton.block.v1",
  "packet_id": "uuid",
  "run_id": "uuid",
  "task_id": "uuid",
  "submitted_at": "2026-08-07T00:05:00.000Z",
  "reason_code": "missing_credential",
  "summary": "The GitHub token cannot read the target repository.",
  "questions": [
    "Grant the configured token read access to trippyogi/baton?"
  ],
  "preserved_work": [],
  "artifacts": []
}
```

A valid BlockPacket terminally marks the run `blocked`, sets `result_kind = blocked`, and creates or updates one structured TaskBlocker. It does not create a review item. Duplicate equivalent packets are idempotent.

#### FailurePacket v1

```json
{
  "schema_version": "baton.failure.v1",
  "packet_id": "uuid",
  "run_id": "uuid",
  "task_id": "uuid",
  "submitted_at": "2026-08-07T00:05:00.000Z",
  "failure_code": "executor_exit_nonzero",
  "summary": "The configured executor exited before producing a result.",
  "retryable": true,
  "diagnostic_artifact_ids": ["uuid"]
}
```

Failure handling:

- The current run always becomes terminal `failed` with `result_kind = failure`.
- When `retryable = true` and execution retry budget remains, BATON creates exactly one child run of kind `retry` and keeps the task `in_progress`.
- When the retry budget is exhausted or `retryable = false`, BATON creates a structured TaskBlocker unless policy explicitly maps the failure to task cancellation.
- A FailurePacket never creates a human review item.

### 12.6 Invalid completion behavior

When a completion packet fails syntax or semantic validation:

1. Persist the raw payload in a restricted diagnostic record with size limits and redaction.
2. Mark the current run `invalid_output`.
3. Add a `run.output_invalid` event with machine-readable validation errors.
4. Keep the task `in_progress`.
5. If refinement budget remains, atomically create exactly one child run of kind `refine` containing:
   - Validation errors.
   - Original acceptance criteria.
   - Safe excerpt of the invalid packet.
   - Explicit instruction to return one valid completion packet.
6. Enforce uniqueness so replaying the same invalid completion cannot create a second child run.
7. If refinement budget is exhausted, move the task to `blocked` and persist a structured `automation_exhausted` TaskBlocker.
8. Never create a human review item from the invalid packet.

---

## 13. Dispatch architecture

### 13.1 Adapter interface

```ts
export interface DispatchAdapter {
  readonly type: string

  deliver(input: {
    envelope: DispatchEnvelopeV1
    dispatch: Dispatch
    attempt: DispatchAttempt
    endpoint: AgentEndpoint
    security: {
      callbackBearerToken: string
    }
    signal: AbortSignal
  }): Promise<TransportDeliveryReceipt>

  cancel?(input: {
    run: Run
    dispatch: Dispatch
    endpoint: AgentEndpoint
    agentRunId: string | null
    signal: AbortSignal
  }): Promise<TransportCancellationReceipt>
}
```

`TransportDeliveryReceipt` means only that the transport accepted one delivery attempt. It does not transition the logical Dispatch to `acknowledged` or the Run to `running`.

The adapter receives the stable DispatchEnvelope plus attempt metadata. It MUST use the same `dispatch_id` and idempotency key for transport retries. It MUST NOT mutate the envelope between attempts except for transport-level headers such as request ID, attempt number, signature timestamp, or callback credential.

### 13.2 Reference adapters

Phase order:

1. `MockAgentAdapter` — deterministic local demo and tests.
2. `HttpWebhookAdapter` — reference production adapter.
3. `BatondHttpAdapter` — specialized HTTP endpoint using the same contracts.
4. `RedisStreamAdapter` — optional later transport.
5. File, Discord bridge, or MCP adapters — deferred.

### 13.3 HTTP delivery semantics

- BATON sends `POST /v1/dispatch` with the DispatchEnvelope.
- The endpoint may return `202 Accepted` as a transport receipt.
- The worker must still call the ACK callback with DispatchAck.
- `200` with a DispatchAck may be supported by `batond`, but BATON still persists it through the same ACK service.
- A callback ACK may race and arrive before the delivery HTTP response. The ACK service may advance a `sending` or `delivered` dispatch to `acknowledged`; the later transport receipt must be idempotent and must never regress it to `delivered`.
- Requests use the stable logical dispatch idempotency key.
- Each HTTP request also carries a unique delivery-attempt ID for audit.
- The per-dispatch callback credential is delivered in an authorization header or mutually authenticated secure channel, not in the JSON body.
- Redirects are disabled by default to reduce SSRF risk.
- Endpoint hosts are allowlisted and resolved addresses are checked against the configured network policy.
- Connect, response, ACK, heartbeat, and overall run timeouts are configured separately.

### 13.4 Transactional dispatch outbox

Creating a run and queuing its dispatch occurs in one SQLite transaction:

1. Verify the task has no active non-terminal run.
2. Insert run as `pending_dispatch` and set `tasks.current_run_id`.
3. Insert one logical dispatch as `queued` with a unique idempotency key and ACK deadline policy.
4. Insert `run.created` and `dispatch.queued` events.
5. Commit.

A dispatcher loop claims due logical dispatches:

1. Atomically mark `queued/retry_wait` as `sending` with a claim token.
2. Insert a DispatchAttempt as `started` with a unique attempt ID and attempt number.
3. Load and validate the immutable envelope.
4. Call the adapter outside the database transaction.
5. On transport acceptance, mark the attempt `accepted`, mark the dispatch `delivered`, set `ack_deadline_at`, and move the run to `dispatched` in one transaction.
6. On retryable transport error, mark the attempt `retryable_error` and schedule the logical dispatch as `retry_wait` with bounded exponential backoff and jitter.
7. On permanent or exhausted transport error, mark the attempt and dispatch `failed`, terminally mark the run `dispatch_failed`, and apply execution-retry policy by creating a child run when allowed.
8. If the ACK deadline expires, mark the dispatch `ack_timed_out`, terminally mark the run `dispatch_failed` with `failure_code = ack_timeout`, expire its callback credential, and issue a best-effort cancel/supersede command by `dispatch_id` before creating a retry child.
9. A late ACK or callback for an expired/superseded dispatch is rejected or stored audit-only; it cannot revive the run.
10. Never reopen the failed run and never create more than one retry child for the same terminal outcome.

### 13.5 Idempotency

Unique constraints:

- `dispatches.idempotency_key`
- `(dispatch_id, attempt_number)` for DispatchAttempts
- `dispatch_attempts.attempt_id`
- `run_events.event_id`
- `(run_id, source, source_sequence)` where sequence exists
- `review_packets.run_id`
- `runs.parent_run_id` for non-null parent IDs, enforcing one child per parent
- `review_decisions.idempotency_key`
- GitHub webhook `delivery_id`

Duplicate valid messages return success without applying a second mutation. Idempotency responses must be semantically stable: a duplicate returns the original resource/result identifier, not a newly generated representation.

### 13.6 Leases, heartbeat, and lost-run detection

- A valid ACK establishes the run's effective lease using BATON server time and `RunPolicy.leaseTimeoutSeconds`.
- A valid heartbeat must carry the acknowledged `agent_run_id` and `lease_id` and must arrive before the effective expiry plus a small configured clock/network grace.
- Every accepted heartbeat extends the effective expiry from trusted server `received_at`; worker timestamps never extend a lease on their own.
- Heartbeats are idempotent by event ID and source sequence.
- A liveness sweeper may mark only `acknowledged` or `running` runs as `lost`.
- Before marking `lost`, the sweeper rechecks state and lease version in the same transaction to avoid racing a heartbeat or completion.
- On `lost`, BATON expires callback credentials, sends best-effort cancellation, persists a diagnostic event, and creates at most one retry child when policy allows.
- A late heartbeat, ACK, or completion from the lost run is audit-only and cannot mutate the task or child run.
- Endpoints that cannot provide heartbeats must declare that limitation and use a stricter fixed execution deadline; they do not receive false "online" health status.

---

## 14. Human review loop

### 14.1 Review eligibility

A task enters `human_review` only when:

- The task's `current_run_id` references a terminal `completed` run.
- A ReviewPacket exists for that run.
- The packet passed schema and semantic validation.
- Any required artifacts are registered and accessible.
- No newer active child run exists.

### 14.2 Review decisions

```ts
export type ReviewDecisionType =
  | 'approve'
  | 'request_changes'
  | 'reject'
```

#### Approve

- Persist decision.
- Mark task `done`.
- Preserve run and review packet unchanged.
- Emit `task.approved` and `task.completed`.

#### Request changes

- Persist decision with required reason.
- Mark task `in_progress`.
- Create a child run of kind `refine`.
- Include the review decision, failed/changed criteria, and current artifacts in lineage.
- Preserve the prior run as terminal `completed`.

#### Reject

- Persist decision with required reason.
- Mark task `cancelled`.
- Preserve `current_run_id` as the reviewed terminal run; cancellation does not erase lineage.
- A reviewer who wants later reconsideration must use an explicit human blocker command instead of overloading rejection semantics.
- Do not delete artifacts or history.

### 14.3 Review UI

The review surface must show:

- Task objective.
- Acceptance criteria and per-criterion evidence.
- Artifact list with integrity metadata when available.
- Checks and their status.
- Risks and known gaps.
- Run lineage and prior review decisions.
- Cost, tokens, duration, and executor identity.
- Approve, request changes, and reject actions.

The UI must not require the reviewer to parse raw JSON or logs to understand whether acceptance criteria passed.

Archive and unarchive controls are separate from review decisions. They only change `archived_at`, require an expected task version, and never alter a review packet, review decision, or terminal outcome.

---

## 15. Database design

### 15.1 Control-plane tables

Required tables:

```text
schema_migrations
tasks
task_dependencies
task_rank_explanations
task_blockers
runs
dispatches
dispatch_attempts
run_events
run_diagnostics
review_packets
review_decisions
artifacts
agent_endpoints
webhook_deliveries
extension_settings
```

### 15.2 Key fields

#### `tasks`

```text
id TEXT PRIMARY KEY
title TEXT NOT NULL
objective TEXT NOT NULL
status TEXT NOT NULL
current_run_id TEXT
owner_id TEXT
tags_json TEXT NOT NULL DEFAULT '[]'
acceptance_criteria_json TEXT NOT NULL
due_at TEXT
impact INTEGER NOT NULL
urgency INTEGER NOT NULL
confidence INTEGER NOT NULL
effort INTEGER NOT NULL
manual_boost INTEGER NOT NULL DEFAULT 0
rank_score INTEGER NOT NULL
why_now_json TEXT NOT NULL
version INTEGER NOT NULL DEFAULT 1
created_at TEXT NOT NULL
updated_at TEXT NOT NULL
archived_at TEXT
legacy_payload_json TEXT
```

#### `task_dependencies`

```text
task_id TEXT NOT NULL
depends_on_task_id TEXT NOT NULL
created_at TEXT NOT NULL
PRIMARY KEY(task_id, depends_on_task_id)
CHECK(task_id <> depends_on_task_id)
```

Dependency writes MUST reject cycles before commit. Deleting a task with dependents is forbidden unless dependencies are explicitly removed or the task is archived under an administrative migration path.

#### `task_rank_explanations`

```text
id TEXT PRIMARY KEY
task_id TEXT NOT NULL
algorithm_version TEXT NOT NULL
score INTEGER NOT NULL
factors_json TEXT NOT NULL
blocked_reasons_json TEXT NOT NULL
summary TEXT NOT NULL
calculated_at TEXT NOT NULL
```

`tasks.why_now_json` is the current materialized explanation. This table preserves history whenever rank inputs or dependency readiness change.

#### `task_blockers`

```text
id TEXT PRIMARY KEY
task_id TEXT NOT NULL
run_id TEXT
source_packet_id TEXT
reason_code TEXT NOT NULL
summary TEXT NOT NULL
questions_json TEXT NOT NULL DEFAULT '[]'
status TEXT NOT NULL              -- open | resolved | dismissed
resolution_note TEXT
created_at TEXT NOT NULL
resolved_at TEXT
version INTEGER NOT NULL DEFAULT 1
```

At most one open blocker may exist for the same `(task_id, reason_code, run_id)` tuple. Resolving a blocker does not automatically dispatch work; it only re-evaluates task readiness.

#### `runs`

```text
id TEXT PRIMARY KEY
task_id TEXT NOT NULL
parent_run_id TEXT
attempt_number INTEGER NOT NULL
kind TEXT NOT NULL
status TEXT NOT NULL
result_kind TEXT
agent_endpoint_id TEXT NOT NULL
agent_run_id TEXT
current_dispatch_id TEXT
policy_json TEXT NOT NULL
input_snapshot_json TEXT NOT NULL
acknowledged_at TEXT
started_at TEXT
ended_at TEXT
failure_code TEXT
failure_message TEXT
cost_usd REAL NOT NULL DEFAULT 0
token_usage_json TEXT NOT NULL DEFAULT '{}'
version INTEGER NOT NULL DEFAULT 1
created_at TEXT NOT NULL
updated_at TEXT NOT NULL
```

#### `dispatches`

```text
id TEXT PRIMARY KEY
run_id TEXT NOT NULL
adapter_type TEXT NOT NULL
endpoint_id TEXT NOT NULL
status TEXT NOT NULL
idempotency_key TEXT NOT NULL UNIQUE
attempt_count INTEGER NOT NULL DEFAULT 0
claim_token TEXT
next_attempt_at TEXT
delivered_at TEXT
ack_deadline_at TEXT
acknowledged_at TEXT
callback_secret_hash TEXT
callback_secret_expires_at TEXT
last_error_code TEXT
last_error_message TEXT
version INTEGER NOT NULL DEFAULT 1
created_at TEXT NOT NULL
updated_at TEXT NOT NULL
```

Only the secret hash and expiry are persisted in BATON. The plaintext callback token is exposed once to the adapter through a redacted in-memory delivery context and is never serialized into the stored envelope or logs.

#### `dispatch_attempts`

```text
attempt_id TEXT PRIMARY KEY
dispatch_id TEXT NOT NULL
attempt_number INTEGER NOT NULL
status TEXT NOT NULL              -- started | accepted | retryable_error | permanent_error
request_id TEXT NOT NULL
started_at TEXT NOT NULL
ended_at TEXT
http_status INTEGER
transport_message_id TEXT
error_code TEXT
error_message TEXT
UNIQUE(dispatch_id, attempt_number)
```

#### `run_events`

```text
id TEXT PRIMARY KEY
run_id TEXT NOT NULL
event_type TEXT NOT NULL
source TEXT NOT NULL
source_sequence INTEGER
occurred_at TEXT NOT NULL
received_at TEXT NOT NULL
payload_json TEXT NOT NULL
UNIQUE(run_id, source, source_sequence)
```

When `source_sequence` is null, `event_id` remains the dedupe key. Worker-originated state-changing events require a sequence.

#### `run_diagnostics`

```text
id TEXT PRIMARY KEY
run_id TEXT NOT NULL
kind TEXT NOT NULL                -- invalid_output | executor_failure | migration
error_codes_json TEXT NOT NULL
redacted_excerpt TEXT
artifact_id TEXT
created_at TEXT NOT NULL
access_level TEXT NOT NULL        -- operator | extension
```

Diagnostics are not returned by normal public run endpoints. They are size-limited and available only through an operator-authorized route or direct local inspection.

#### `review_packets`

```text
id TEXT PRIMARY KEY
run_id TEXT NOT NULL UNIQUE
task_id TEXT NOT NULL
schema_version TEXT NOT NULL
summary TEXT NOT NULL
acceptance_criteria_json TEXT NOT NULL
checks_json TEXT NOT NULL
risks_json TEXT NOT NULL
known_gaps_json TEXT NOT NULL
recommended_decision TEXT
submitted_at TEXT NOT NULL
validated_at TEXT NOT NULL
created_at TEXT NOT NULL
```

#### `review_decisions`

```text
id TEXT PRIMARY KEY
review_packet_id TEXT NOT NULL
task_id TEXT NOT NULL
decision TEXT NOT NULL            -- approve | request_changes | reject
reason TEXT
idempotency_key TEXT NOT NULL UNIQUE
expected_task_version INTEGER NOT NULL
created_at TEXT NOT NULL
```

Only one effective approval or rejection may finalize a review packet. A request-changes decision may occur once per packet and must create at most one child refinement run.

#### `artifacts`

```text
id TEXT PRIMARY KEY
run_id TEXT NOT NULL
kind TEXT NOT NULL
label TEXT NOT NULL
uri TEXT NOT NULL
sha256 TEXT
size_bytes INTEGER
media_type TEXT
retention_policy TEXT
created_at TEXT NOT NULL
```

#### `agent_endpoints`

```text
id TEXT PRIMARY KEY
name TEXT NOT NULL
adapter_type TEXT NOT NULL
enabled INTEGER NOT NULL
base_url TEXT
capabilities_json TEXT NOT NULL DEFAULT '[]'
supported_contract_ids_json TEXT NOT NULL DEFAULT '[]'
auth_ref TEXT
config_json TEXT NOT NULL DEFAULT '{}'
last_heartbeat_at TEXT
version INTEGER NOT NULL DEFAULT 1
created_at TEXT NOT NULL
updated_at TEXT NOT NULL
```

`auth_ref` points to environment/secret-manager configuration; no raw endpoint secret is stored in this table.

### 15.2.1 Required constraints and indexes

- Foreign keys are explicit and enabled.
- Integer score inputs have `CHECK` constraints for their documented ranges.
- Status/result fields have `CHECK` constraints generated from the canonical enums where practical.
- A partial unique index enforces one non-terminal run per task.
- `tasks.current_run_id`, when non-null, must reference the latest run in that task's active lineage; it may remain on a terminal run while awaiting review.
- A partial index supports due dispatcher claims on `(status, next_attempt_at)`.
- A partial unique index on non-null `runs.parent_run_id` enforces linear lineage and prevents sibling child runs.
- A unique index prevents more than one review packet per run.
- Artifact lookup indexes include `(run_id, created_at)`.
- Webhook delivery IDs are unique per provider.

### 15.3 Event log policy

The event log is for audit and operational diagnosis. BATON is not a pure event-sourced system.

- Materialized tables remain the read source for normal API requests.
- Every accepted state transition writes an event transactionally.
- Events are append-only.
- Rebuild-from-events tooling is optional and deferred.
- Payloads are size-limited and redacted.

### 15.4 SQLite operational rules

- WAL mode enabled.
- Foreign keys enabled.
- Busy timeout configured.
- All write operations go through repositories and domain services.
- Long network calls never occur inside SQLite transactions.
- BATON API is the only writer to the control-plane database.
- `batond` uses its own local state database.
- Database path is fully configurable.

### 15.5 Migrations

- Numbered SQL migrations live under `db/migrations`.
- A `schema_migrations` table records applied migrations and checksums.
- Migrations run through an explicit command before startup in production.
- Development MAY auto-migrate when enabled.
- Before any migration, the command creates a timestamped backup unless `--no-backup` is explicitly set in a disposable environment.
- Destructive drops are deferred until the compatibility window closes.
- Migration tests must start from a checked-in legacy database fixture.
- The migration command runs `PRAGMA integrity_check` and `PRAGMA foreign_key_check` before and after applying changes.
- Data-copy migrations record pre/post row counts and deterministic checksums for critical identifiers and statuses.
- SQLite table rebuilds use create-copy-validate-swap steps inside the smallest safe transaction; no destructive source table is dropped before validation passes.
- Production rollback uses the timestamped backup rather than an unproven reverse migration.
- After migration, the application starts in compatibility/read-only-new-features mode until smoke checks pass; dispatch remains disabled by default.

---

## 16. API design

### 16.1 Versioned routes

New APIs live under `/api/v1`.

#### Tasks

```text
GET    /api/v1/tasks
POST   /api/v1/tasks
GET    /api/v1/tasks/:taskId
PATCH  /api/v1/tasks/:taskId
POST   /api/v1/tasks/:taskId/prepare
POST   /api/v1/tasks/:taskId/dispatch
POST   /api/v1/tasks/:taskId/cancel
POST   /api/v1/tasks/:taskId/archive
POST   /api/v1/tasks/:taskId/unarchive
GET    /api/v1/tasks/:taskId/runs
GET    /api/v1/tasks/:taskId/blockers
POST   /api/v1/tasks/:taskId/blockers
POST   /api/v1/tasks/:taskId/blockers/:blockerId/resolve
```

#### Runs and dispatch

```text
GET    /api/v1/runs/:runId
GET    /api/v1/dispatches/:dispatchId
GET    /api/v1/dispatches/:dispatchId/attempts
POST   /api/v1/dispatches/:dispatchId/ack
POST   /api/v1/runs/:runId/events
POST   /api/v1/runs/:runId/completion
POST   /api/v1/runs/:runId/cancel
GET    /api/v1/runs/:runId/events
GET    /api/v1/runs/:runId/artifacts
```

#### Review

```text
GET    /api/v1/reviews
GET    /api/v1/reviews/:reviewPacketId
POST   /api/v1/reviews/:reviewPacketId/decisions
```

#### Agents and health

```text
GET    /api/v1/agent-endpoints
POST   /api/v1/agent-endpoints/:id/test
GET    /api/v1/health
GET    /api/v1/events/stream
```

#### Webhooks

```text
POST   /api/v1/webhooks/github
```

### 16.2 Command payloads and responses

Prepare command:

```json
{
  "expected_version": 6
}
```

Successful prepare returns the updated Task and does not create a Run.

Dispatch command:

```json
{
  "expected_version": 7,
  "endpoint_id": "spectre-local",
  "prepared_context": {
    "instructions": "Implement the approved Phase 0 scope only.",
    "reference_artifact_ids": ["uuid"]
  },
  "policy_overrides": {
    "timeout_seconds": 1800,
    "max_cost_usd": 5,
    "max_execution_retries": 1,
    "max_refinement_runs": 2
  }
}
```

Successful dispatch returns HTTP 202:

```json
{
  "task_id": "uuid",
  "run_id": "uuid",
  "dispatch_id": "uuid",
  "run_status": "pending_dispatch",
  "dispatch_status": "queued"
}
```

Rules:

- `prepared_context` is schema-validated, size-limited, snapshotted into the Run, and must not contain raw secrets.
- Policy overrides may only make policy stricter than or equal to operator ceilings unless an authorized operator role explicitly permits otherwise.
- The selected endpoint must be enabled, advertise every required capability, and support the DispatchEnvelope major plus required callback packet majors before the transaction commits.
- The dispatch command is idempotent by `Idempotency-Key` and task version.

Review decision command:

```json
{
  "decision": "request_changes",
  "reason": "Acceptance criterion ac-2 lacks test evidence.",
  "expected_task_version": 12,
  "changed_criterion_ids": ["ac-2"]
}
```

Human blocker command:

```json
{
  "expected_task_version": 9,
  "reason_code": "operator_dependency",
  "summary": "Waiting for repository access approval.",
  "questions": ["Has read/write access been granted?"]
}
```

### 16.3 Error envelope

```json
{
  "error": {
    "code": "invalid_state_transition",
    "message": "Run cannot transition from completed to running.",
    "request_id": "uuid",
    "details": {
      "from": "completed",
      "to": "running"
    }
  }
}
```

- Public messages are safe and stable.
- Internal stack traces stay in structured logs.
- Validation errors include field paths.
- Conflict and idempotency conditions use appropriate 409/200 semantics.
- Create/dispatch/review-decision commands accept an `Idempotency-Key` header.
- `POST /tasks/:id/prepare` validates objective, acceptance criteria, dependencies, and open blockers, recalculates rank, and moves `triage/blocked` to `ready` only when the task is actionable. It does not create a run, select an endpoint, or contact an agent.
- `POST /tasks/:id/dispatch` accepts the selected endpoint and bounded policy overrides, atomically captures the RunInputSnapshot, creates the run/dispatch, and returns 202.
- Mutating task, blocker, endpoint, and review commands require `If-Match` or an explicit `expected_version`; stale writes return 409 with the current version.
- `POST /tasks/:id/dispatch` returns 202 after the run and logical dispatch are transactionally queued, not after an agent ACK.
- Callback routes authenticate with the per-dispatch credential and never accept a browser session credential as a substitute.

### 16.4 Compatibility routes

Existing `/api/tasks`, `/api/runs`, `/api/overview`, and related routes remain available during migration.

- They call the same domain services as `/api/v1`.
- They may transform results into legacy shapes.
- They are marked deprecated in logs and docs.
- They are removed only after the migrated frontend and parent application no longer call them.

### 16.5 Server-Sent Events

SSE remains the browser update mechanism.

- Events include `event_id`, `type`, `task_id`, `run_id`, entity version, and timestamp.
- Clients reconnect with `Last-Event-ID`.
- The server can replay a bounded window from `run_events` or a lightweight notification table.
- Events outside the replay window trigger a client refetch rather than an unbounded scan.
- Large logs are not sent through the general event stream; clients request paginated or tailed log data.
- SSE is notification transport, not authoritative state. Clients re-read the API after reconnect or version gaps.

---

## 17. Extension system

### 17.1 Typed interface

```ts
export interface BatonExtension {
  name: string
  version: string

  register(context: BatonExtensionContext): Promise<void> | void
}

export interface BatonExtensionContext {
  app: Express
  services: BatonServices
  repositories: Readonly<BatonRepositories>
  config: ExtensionConfig
  logger: Logger
}
```

### 17.2 Loader behavior

- Extension location is configured, not hard-coded.
- Absence is allowed when no extension is configured.
- A configured extension that fails to import or register fails startup.
- Registration errors are never rewritten as “extension absent.”
- Extensions receive service interfaces, not unrestricted raw database access by default.
- Extension configuration is schema-validated.

### 17.3 Move out of public core

The following current behavior belongs in an extension or example integration:

- Meta ad spend and performance routes.
- Creative-log filesystem route.
- Host memory-file route.
- Hard-coded agent roster, Discord IDs, models, paths, and session keys.
- Personal shared-request user allowlists.
- ExampleCorp-specific seeds and alerts.

The public core may ship generic examples, but no private values.

### 17.4 Public-safe audit

CI must fail when the public core contains configured sensitive patterns, including:

- Home-directory usernames.
- Public IP addresses not present in fixtures/docs allowlists.
- Discord channel/user IDs.
- Access tokens or secret-like values.
- Meta account IDs.
- Private company/project names in seed data.
- Absolute operational paths.

The audit needs an explicit allowlist so documentation examples can be intentional.

---

## 18. `batond` Rust runtime

### 18.1 Purpose

`batond` is an optional single-host execution supervisor for jobs already specified and approved for dispatch by BATON and/or the external reasoning layer. The first guaranteed production target is Linux; macOS and Windows support require separate acceptance work because process-tree, signal, and worktree behavior differs.

### 18.2 Explicit non-responsibilities

`batond` MUST NOT:

- Rank tasks.
- Generate `why_now`.
- Choose goals.
- Decide which agent should receive work.
- Rewrite task acceptance criteria.
- Interpret business strategy.
- Approve output.
- Write BATON's database.
- Become a second orchestrator.

### 18.3 Internal modules

```text
crates/batond/src/
├── api/
│   ├── dispatch.rs
│   ├── cancel.rs
│   ├── health.rs
│   └── status.rs
├── contracts/
├── state/
│   ├── database.rs
│   └── leases.rs
├── supervisor/
│   ├── process_tree.rs
│   ├── cancellation.rs
│   ├── timeout.rs
│   └── heartbeat.rs
├── executors/
│   ├── mod.rs
│   ├── mock.rs
│   └── command.rs
├── workspace/
│   ├── roots.rs
│   ├── worktrees.rs
│   └── cleanup.rs
├── artifacts/
├── callbacks/
├── config.rs
├── error.rs
└── main.rs
```

### 18.4 HTTP surface

```text
GET  /health
POST /v1/dispatch
POST /v1/runs/:agentRunId/cancel
GET  /v1/runs/:agentRunId
```

`POST /v1/dispatch` flow:

1. Authenticate BATON.
2. Enforce request size limit.
3. Validate JSON Schema and Serde shape.
4. Verify idempotency key.
5. Verify executor and workspace policy.
6. Persist the accepted job, callback-auth handle, lease, and execution intent in local runtime SQLite.
7. Return or send DispatchAck only after the transaction commits.
8. Spawn the executor exactly once under the persisted execution identity.
9. Send `run.started` only after spawn succeeds and the process identity is durably recorded.
10. If spawn fails after ACK, send one FailurePacket with `failure_code = executor_spawn_failed`; never emit `run.started`.
11. Stream heartbeats, logs, artifacts, and completion callbacks.

### 18.5 Local runtime persistence

`batond` maintains a separate SQLite database containing:

- Accepted dispatches and stable execution identities.
- Runtime status.
- Lease data.
- Process IDs/process-group IDs plus process start identity to detect PID reuse.
- Workspace/worktree paths.
- Callback credential handles or encrypted ephemeral material; never plaintext logs.
- Callback delivery attempts.
- Durable stdout/stderr file locations and last emitted sequence.
- Cleanup status.

This database is operational state only. BATON remains authoritative.

### 18.6 Executor interface

```rust
#[async_trait]
pub trait Executor: Send + Sync {
    fn kind(&self) -> &'static str;

    async fn validate(&self, job: &ResolvedJob) -> Result<(), ExecutorError>;

    async fn spawn(
        &self,
        job: ResolvedJob,
        context: ExecutionContext,
    ) -> Result<RunningExecution, ExecutorError>;
}
```

Initial executors:

1. `MockExecutor` for contract and lifecycle tests.
2. `CommandExecutor` using a server-side allowlisted executor definition.

The envelope MUST NOT contain an arbitrary shell command to execute directly.

### 18.7 Process supervision

The supervisor must:

- Spawn a process group/session, not only one child PID.
- Capture stdout and stderr separately.
- Bound in-memory log buffers.
- Stream chunks with sequence numbers.
- Persist enough state for restart recovery before reporting lifecycle milestones.
- Write stdout/stderr to durable per-run files while streaming bounded chunks so a daemon restart can resume tailing without duplicating sequence numbers.
- On restart, verify process identity using PID/process-group plus start metadata; never trust a reused PID.
- Reattach monitoring when safe, or terminate/reconcile the process as lost. Never blindly spawn a second copy.
- Send heartbeats.
- Enforce timeout.
- Handle graceful cancel followed by forced termination.
- Kill the full process tree.
- Mark cleanup status explicitly.
- Never report `cancelled` before the process tree is confirmed stopped.

### 18.8 Worktree lifecycle

When a resolved job requires Git work:

1. Resolve repository through an allowlisted repository configuration.
2. Use a controlled local mirror/cache.
3. Create a unique worktree per run.
4. Verify the base revision.
5. Give the executor only the run workspace.
6. Capture final revision and diff metadata.
7. Register artifacts.
8. Remove the worktree after completion or retain it under an explicit debugging policy.
9. Clean stale worktrees after restart.

### 18.9 Artifacts

`batond` creates an artifact manifest with:

- Workspace-relative path.
- Type.
- Size.
- SHA-256 when feasible.
- Media type.
- Created time.
- Retention policy.

`batond` sends metadata to BATON. Upload/storage transport is configurable and may initially be local.

### 18.10 Rust scope gate

Phase 6 process supervision should proceed only after Phase 4 proves the TypeScript lifecycle and at least one concrete runtime need exists, such as:

- Orphaned processes.
- Unreliable cancellation.
- Worktree collisions.
- Concurrent execution pressure.
- Need for crash-resilient leases.
- Need for a portable single binary.

The minimal Phase 5 contract/runtime skeleton may be built earlier to prove interoperability. It must not become a requirement for the basic BATON demo.

---

## 19. Security and trust boundaries

### 19.1 Exposure policy

- Default bind host: `127.0.0.1`.
- Binding to a non-loopback address without configured auth MUST fail startup.
- Supported initial auth modes:
  - `disabled` for loopback only.
  - Static bearer token for trusted private deployments.
  - Trusted reverse-proxy identity mode.
- Multi-user identity is deferred.

### 19.2 Webhook and callback security

- GitHub webhook validation uses raw request bytes.
- Signature lengths are checked before constant-time comparison.
- GitHub delivery IDs are deduplicated.
- Event type is checked before payload interpretation.
- Dispatch callback credentials are scoped per dispatch/run and stored hashed in BATON. The plaintext credential is delivered once through the authenticated transport context and is never part of the persisted DispatchEnvelope.
- Callback requests include timestamp and nonce or event ID.
- Callback credentials expire no later than the terminal run plus a short replay window.
- Replays are idempotent.

### 19.3 SSRF controls

- Agent endpoint URLs are configured by an operator, not supplied by task payloads.
- Endpoint scheme is `https` by default; loopback `http` is allowed for local development.
- Redirect following is disabled or restricted.
- Private-network destinations require explicit allowlisting.
- Resolve and validate all destination addresses before connect; where the HTTP client permits it, pin the validated address for the request to reduce DNS rebinding risk.
- DNS rebinding and proxy-bypass tests are required for externally exposed deployments.

### 19.4 Command and path safety

- `batond` runs only configured executor definitions.
- No arbitrary shell string execution from DispatchEnvelope.
- Environment variables use an allowlist.
- Secrets are referenced, not embedded.
- Workspace roots are canonicalized.
- Symlink escapes and path traversal are rejected.
- Artifact paths must remain inside the run workspace.
- The runtime runs as an unprivileged user.
- Phase 6 process-tree guarantees are Linux-specific and use process groups/sessions; unsupported operating systems must fail capability checks rather than claiming equivalent safety.

### 19.5 Data minimization

- Raw invalid model output is size-limited, redacted, and access-controlled.
- Logs redact configured secret patterns.
- Tokens and credentials never appear in events or review packets.
- Public-safe CI prevents operational data from entering the public repository.

---

## 20. Observability

### 20.1 Correlation identifiers

Every log and event should include available values from:

- `request_id`
- `task_id`
- `run_id`
- `dispatch_id`
- `agent_run_id`
- `worker_id`
- `review_packet_id`

### 20.2 Required health data

BATON health:

- Database reachable.
- Migration version.
- Dispatcher loop status.
- Oldest queued dispatch age.
- Configured endpoint count.
- Endpoint heartbeat freshness.
- Review queue count.
- Active run count.

`batond` health:

- Runtime database reachable.
- Supervisor loop alive.
- Active process count.
- Stale lease count.
- Pending callback count.
- Cleanup backlog.

### 20.3 Metrics

Initial metrics can be derived through API queries and structured logs. OpenTelemetry is deferred.

Required operational measures:

- Dispatch delivery latency.
- ACK latency.
- Start latency after ACK.
- Run duration.
- Completion-validation failure rate.
- Refinement count per task.
- Human approval/request-change rate.
- Stale lease count.
- Cancellation completion time.
- Orphan cleanup count.
- Cost and token usage.

---

## 21. Test strategy

### 21.1 Unit tests

Required units:

- Task transition function, including archive orthogonality.
- Run transition function.
- Dispatch transition function and DispatchAttempt recording.
- Terminal-state guard.
- One-active-run invariant.
- Optimistic concurrency/version guard.
- Dependency cycle detection.
- Rank formula and explanation.
- Contract schemas.
- Review semantic validator and placeholder-sentinel rules.
- Retry/refinement policy, linear-lineage rule, and unique-child guard.
- HMAC verification.
- Environment configuration.
- Extension loader error classification.

### 21.2 API integration tests

Use a temporary SQLite database and real Express app instance.

Required cases:

- Task CRUD and legacy response parity.
- Dispatch creation is transactional and enforces one active run.
- Every transport send creates one DispatchAttempt.
- Transport receipt does not create ACK.
- ACK changes `dispatched` to `acknowledged` only.
- ACK timeout creates a terminal dispatch/run outcome and at most one retry child.
- `run.started` before ACK is rejected.
- Completion creates validation state and BATON's canonical completion-submitted event.
- Completion validation uses the run snapshot even when task metadata changed later.
- Mutating objective/criteria/dependencies while a run is active returns 409.
- Valid review packet creates human review item.
- Valid block packet creates a TaskBlocker and terminal blocked run, not a review item.
- Retryable failure creates at most one retry child; non-retryable failure creates a blocker by default.
- Invalid packet creates exactly one refinement child run even under replay.
- Review decision is idempotent and stale expected versions return 409.
- Archive/unarchive does not change task status or reopen terminal work.
- Terminal run rejects mutation.
- External bind without auth fails configuration validation.
- Callback credential cannot be substituted with browser/user auth.

### 21.3 Contract tests

Committed fixtures:

```text
packages/contracts/fixtures/
├── valid/
│   ├── dispatch.v1.json
│   ├── ack.v1.json
│   ├── review.v1.json
│   ├── block.v1.json
│   └── failure.v1.json
└── invalid/
    ├── ack-wrong-run.json
    ├── ack-expired-credential.json
    ├── event-out-of-order.json
    ├── review-missing-criterion.json
    ├── review-foreign-artifact.json
    ├── review-placeholder-sentinel.json
    ├── block-missing-reason.json
    ├── unknown-schema-version.json
    └── oversized-payload.json
```

The same fixtures must pass/fail identically in TypeScript and Rust.

### 21.4 End-to-end tests

Critical browser flows:

1. Create task.
2. Inspect `why_now`.
3. Dispatch to mock agent.
4. Observe delivered, acknowledged, and running as distinct states.
5. Receive valid review packet.
6. Review artifacts and criteria.
7. Request changes.
8. Observe child refinement run.
9. Approve final result.
10. Confirm task done and history immutable.

### 21.5 Adversarial loop-integrity suite

This suite is a release gate.

| Scenario | Expected result |
|---|---|
| Fake `run.started` before ACK | 409; run remains `dispatched`. |
| ACK with wrong run ID | Rejected and audited. |
| Duplicate ACK | Idempotent success; no second transition. |
| ACK deadline expires | Dispatch becomes `ack_timed_out`; run becomes `dispatch_failed`; at most one retry child. |
| ACK after run terminal | Ignored/rejected; terminal state unchanged. |
| Completion for stale parent after child active | Stored for audit; task state unchanged. |
| Malformed JSON completion | Current run `invalid_output`; exactly one refinement child created. |
| Duplicate malformed completion replay | Idempotent diagnostic; no second child run. |
| Well-formed packet missing required criterion | Same as invalid output by default policy. |
| Review packet references artifact from another run | Rejected; refinement path. |
| Duplicate review decision | Idempotent; one child run maximum and no sibling branch. |
| Request changes after approval | Rejected; task terminal. |
| Archive completed task | `archived_at` changes; status remains `done`. |
| Unarchive cancelled task | Visibility restored; status remains `cancelled`. |
| Stale UI mutation | 409; newer entity version remains authoritative. |
| Two simultaneous dispatch commands | One active run and one logical dispatch maximum. |
| GitHub webhook replay | One fix/repair run only. |
| Invalid HMAC length | 403, never 500. |
| Dispatcher crash after delivery before local update | Redelivery is idempotent. |
| Worker dies after ACK | Lease expiry marks run `lost`; retry child follows policy. |
| Cancellation races completion | First valid terminal transition wins; later event audited only. |
| Max refinement count reached | Task becomes structured `blocked`, not infinite loop. |
| Extension throws during register | Startup fails visibly. |
| SSRF endpoint resolves to disallowed private address | Delivery rejected before connect. |
| Callback uses wrong/expired per-dispatch credential | 401/403; no state change. |
| Redis unavailable | Core HTTP/mock workflow remains operational. |

### 21.6 Rust tests

- Contract fixture conformance.
- Dispatch idempotency.
- ACK only after local persistence.
- Restart recovery without duplicate spawn, including PID-reuse defense.
- Durable log tail/sequence recovery.
- Process-group cancellation.
- Timeout escalation.
- Log sequence ordering.
- Bounded log buffering.
- Workspace path escape and symlink-escape rejection.
- Unsupported-OS capability failure for Linux-only guarantees.
- Worktree cleanup after success, failure, kill, and restart.
- Callback retry, credential expiry, and dedupe.

### 21.7 CI pipeline

Required checks:

```text
Node lane
- npm ci
- formatting/lint
- typecheck
- unit tests
- API integration tests
- contract generation has no diff
- web build
- Playwright critical flow
- legacy DB migration test
- public-safe audit
- production dependency audit

Rust lane
- cargo fmt --check
- cargo clippy --all-targets --all-features -- -D warnings
- cargo test --all
- cross-language contract fixtures
- cargo audit or approved equivalent
```

---

## 22. Local development and demo

### 22.1 Core demo

The core demo must require only Node/npm.

```bash
npm ci
npm run dev
```

Development mode starts:

- BATON API.
- Vite browser app.
- Mock agent endpoint.
- Temporary or configured SQLite database.

Redis is not required.

### 22.2 Deterministic demo command

```bash
npm run demo
```

The command should:

1. Create a generic task.
2. Calculate `why_now`.
3. Dispatch through MockAgentAdapter.
4. Emit a real ACK.
5. Emit `run.started`.
6. Emit logs and one artifact.
7. Submit a valid ReviewPacket.
8. Leave the task awaiting human approval.

A second fixture demonstrates invalid output and automatic refinement:

```bash
npm run demo:refinement
```

### 22.3 Rust demo

After Phase 5:

```bash
npm run demo:batond
```

This starts BATON, `batond`, and MockExecutor. The observable lifecycle must match the TypeScript mock adapter lifecycle.

---

## 23. Phased implementation roadmap

Each phase should be one focused PR or a small ordered PR series. Do not merge a phase with failing exit criteria.

### 23.1 Phase overview and dependencies

| Phase | Primary output | Depends on | Relative effort | Rust required | Safe stopping point |
|---:|---|---|---:|---|---|
| 0 | Reproducible, public-safe JavaScript baseline | Current repo | M | No | Yes |
| 1 | Strict TypeScript API with legacy parity | 0 | L | No | Yes |
| 2 | Vanilla TypeScript web app and typed SDK | 1 | M | No | Yes |
| 3 | Canonical task/run/dispatch domain and ranking | 1–2 | L | No | Yes |
| 4 | HTTP dispatch, real ACK, review, blockers, retries/refinement | 3 | XL | No | **Recommended v1 control-plane release** |
| 5 | `batond` contract/lifecycle skeleton | 4 | M | Yes | Yes; optional runtime |
| 6 | Linux process supervisor and worktree safety | 5 plus measured need | XL | Yes | Yes |
| 7 | Optional Redis adapter and production hardening | 4; 5–6 only when used | L | Optional | Final roadmap state |

Relative effort is comparative (`M`, `L`, `XL`), not a wall-clock promise. Phases 0–4 produce a complete BATON control plane. Phases 5–7 are additive and must not be allowed to delay or destabilize that usable TypeScript release.

### Phase 0 — Stabilize and establish the baseline

**Objective:** Make the current repository reproducible, testable, public-safe, and honest before changing language or architecture.

#### Scope

- Current JavaScript layout.
- No frontend rewrite.
- No new dispatch state machine yet.

#### Deliverables

1. Determine and document the authoritative source repository/path, public-mirror sync direction, and release workflow. If `trippyogi/baton` is generated from a parent repository, make code changes in the canonical source and prove the sync output is deterministic.
2. Reconcile `package.json` dependencies with imports.
3. Add deterministic scripts: `start`, `dev`, `test`, `check`.
4. Fix extension loader dependency injection and error classification.
5. Resolve `PORT`/`VMC_PORT` mismatch through one validated configuration path.
6. Remove hard-coded SSH host output.
7. Add `/api/health` with real process/database status.
8. Harden GitHub webhook HMAC length handling and delivery dedupe; an additive `webhook_deliveries` table is allowed even though the broader schema redesign is deferred.
9. Quarantine or move business-specific routes and data behind an extension boundary while preserving route/response compatibility where a consumer exists.
10. Replace private seed data with generic demo fixtures.
11. Add a public-safe scanner.
12. Inventory every browser API/SSE request and repair the current Runs/Overview contract drift (`GET /api/runs`, run detail, and run stream) or remove unsupported live claims explicitly.
13. Add baseline API contract tests for current routes and browser-consumed routes.
14. Add CI for install, smoke, tests, and audit.
15. Document the reviewed baseline SHA and any repository drift.

#### Required tests

- Canonical-source-to-public-mirror sync produces no unexplained diff, or documentation proves the public repo is canonical.
- Clean `npm ci` from an empty workspace.
- Server starts with `.env.example`-compatible configuration.
- Extension absent: startup succeeds.
- Configured extension throws: startup fails.
- Invalid webhook HMAC returns 403.
- Current task and run endpoint shapes match checked-in snapshots; intentionally private fixture values are replaced by documented generic equivalents.
- Runs screen can list, open, and receive a real or explicitly degraded live-update path without calling nonexistent endpoints.
- Overview no longer labels run data as live unless the stream is functional.
- Duplicate GitHub delivery ID creates at most one repair action.
- Public-safe audit passes.

#### Exit gate

- Current UI loads.
- Existing API contract suite passes.
- No missing runtime dependencies.
- No hidden extension failure.
- No private operational data in public core.
- CI green.

#### Rollback

Revert the phase PR. No domain schema redesign occurs in this phase; the additive webhook-deduplication table may be dropped independently if rollback requires it.

---

### Phase 1 — TypeScript API foundation

**Objective:** Port the server to strict TypeScript without changing product behavior.

#### Scope

- API, configuration, repositories, route handlers, extension interface.
- Browser remains current JavaScript until Phase 2.

#### Deliverables

1. Create npm workspaces.
2. Add TypeScript 6 configuration with strict mode.
3. Create `packages/contracts` with initial legacy API schemas and generated JSON Schema.
4. Introduce typed configuration validation.
5. Create repository interfaces around SQLite.
6. Port routes one at a time to `apps/api/src`.
7. Remove raw database imports from route modules.
8. Add typed request validation to write routes.
9. Add structured error middleware and request IDs.
10. Add structured logging and secret redaction.
11. Preserve root `npm start` through a compatibility command/shim.
12. Preserve legacy endpoint response shapes.
13. After parity is green, upgrade Express 4 to Express 5 in a separate commit and fix wildcard/fallback behavior explicitly.

#### Type rules

- `strict: true`.
- No implicit `any`.
- No unchecked type assertions at external boundaries.
- `unknown` must be parsed before use.
- Explicit Node types in `tsconfig`.
- ESM imports only in new code.

#### Required tests

- Baseline API snapshots pass against TypeScript implementation.
- Invalid request bodies return typed 400 errors.
- Extension interface compile tests.
- Config failures are deterministic.
- Express 5 upgrade has a dedicated regression test for static files and SPA fallback.

#### Exit gate

- All server runtime code is TypeScript.
- No server-side `.js` implementation remains except temporary compatibility shims.
- Legacy API behavior remains green.
- Strict typecheck passes without blanket suppressions.
- CI green.

#### Rollback

Root start command can switch back to the Phase 0 JavaScript entrypoint until the final cutover commit.

---

### Phase 2 — TypeScript browser and typed SDK

**Objective:** Port the browser code to TypeScript while preserving the existing UX.

#### Deliverables

1. Create `apps/web` with Vite and vanilla TypeScript.
2. Port fetch/SSE helpers into a typed SDK.
3. Port screen modules incrementally.
4. Replace ad hoc response assumptions with contract parsing.
5. Preserve current CSS and visual layout.
6. Add lifecycle badges capable of showing future dispatch states.
7. Add Playwright smoke coverage.
8. Serve the production web build from the API.

#### Constraints

- No React.
- No visual redesign.
- No feature work beyond type safety and preparation for new lifecycle states.
- No raw `fetch` outside the SDK layer after cutover.

#### Exit gate

- All browser application logic is TypeScript.
- API and web builds are independent and reproducible.
- Existing screens retain functional parity.
- Playwright smoke tests pass.
- Legacy browser files can be removed or retained only as explicit shims.

---

### Phase 3 — Canonical domain model, state machines, and ranking

**Objective:** Replace implicit status mutation with the authoritative task/run/dispatch model.

#### Deliverables

1. Add v2 database migrations and legacy fixture migration tests.
2. Add canonical Task, Run, immutable RunInputSnapshot, Dispatch, DispatchAttempt, Event, Artifact, Review, TaskBlocker, and RunDiagnostic entities.
3. Implement task/run/dispatch transition services.
4. Add terminal-state guards, optimistic entity versions, and the one-active-run invariant.
5. Add transactional state + event writes and immutable run input snapshots.
6. Add run lineage and unique child-run creation.
7. Implement rank-v1 and persisted `why_now`.
8. Add task dependency support with cycle rejection.
9. Make archive/unarchive orthogonal to TaskStatus.
10. Add `/api/v1` read/write routes.
11. Make legacy routes call the new services.
12. Update board columns to canonical task states.
13. Update queue UI to stop inferring runtime state from Redis.
14. Add the adversarial state-transition test suite.

#### Exit gate

- No route mutates task/run/dispatch status directly.
- No run can enter `running` through current public routes without a persisted ACK; dispatch actions remain feature-flagged until Phase 4 proves callbacks.
- The database rejects a second active run for the same task.
- Terminal states are immutable in tests.
- Archive/unarchive preserves task outcome.
- Legacy database fixture migrates without data loss or fabricated ACKs/review evidence.
- `why_now` is visible and deterministic.
- All state integrity tests pass.

#### Rollback

- Database backup created before migration.
- Legacy columns remain through the compatibility window.
- Feature flag can keep the new dispatch actions disabled while new reads remain active.

---

### Phase 4 — HTTP dispatch, ACK protocol, review gate, and refinement loop

**Objective:** Prove the complete BATON lifecycle without Rust or Redis.

#### Deliverables

1. Implement DispatchEnvelope, DispatchAck, RunEvent, ReviewPacket, BlockPacket, FailurePacket, and ReviewDecision schemas.
2. Add transactional logical dispatch outbox plus DispatchAttempt history.
3. Implement MockAgentAdapter.
4. Implement HttpWebhookAdapter.
5. Add out-of-band per-dispatch callback credentials, ACK callback endpoint, ACK deadline, and enforcement.
6. Add run event endpoint with sequencing, clock handling, and idempotency.
7. Add completion validation pipeline and canonical BATON completion event.
8. Add automatic invalid-output refinement child runs with replay-safe uniqueness.
9. Add execution retry child runs and max-retry/max-refinement blocking behavior.
10. Add structured TaskBlocker flows for BlockPacket, non-retryable failure, exhausted automation, and explicit human blockers.
11. Add human review queue and decision endpoints with optimistic concurrency.
12. Add review UI with acceptance evidence and artifacts.
13. Add deterministic local demo commands.
14. Refactor GitHub webhook fix jobs through the same Run/Dispatch path.
15. Add callback auth, credential expiry, webhook replay protection, and ACK-timeout sweeper.

#### Exit gate

A local end-to-end test must prove:

1. Task becomes ready.
2. Run is created `pending_dispatch`.
3. Transport delivery changes it to `dispatched` only.
4. Real ACK changes it to `acknowledged`.
5. `run.started` changes it to `running`.
6. An ACK timeout creates a terminal dispatch/run outcome and at most one retry child.
7. A valid BlockPacket creates a TaskBlocker and no review item.
8. A retryable FailurePacket creates at most one retry child.
9. Malformed completion creates `invalid_output` and exactly one child refinement run, with no human review item.
10. Valid completion creates a review item.
11. Request changes creates exactly one child refinement run.
12. Approval marks the task done.
13. Archive/unarchive leaves the terminal status unchanged.
14. Every prior terminal run remains unchanged.

The full adversarial loop-integrity suite must pass.

#### Rollback

Dispatch remains behind `BATON_DISPATCH_ENABLED`. Read-only task/run views can remain active if dispatch is disabled.

---

### Phase 5 — `batond` contract and lifecycle skeleton

**Objective:** Prove TypeScript/Rust interoperability without yet taking on full production execution complexity.

#### Deliverables

1. Add Rust workspace and pinned toolchain.
2. Create `batond` Axum server.
3. Validate committed DispatchEnvelope schemas.
4. Implement local runtime SQLite.
5. Implement dispatch idempotency.
6. Persist accepted work and callback-auth handle before ACK.
7. Implement MockExecutor.
8. Send ACK, started, heartbeat, log, artifact, and valid completion callbacks.
9. Send a structured FailurePacket when spawn fails after ACK.
10. Implement cancellation endpoint for MockExecutor.
11. Add restart-recovery tests that prove no duplicate spawn.
12. Run all shared valid/invalid contract fixtures in Rust.
13. Add `BatondHttpAdapter` in TypeScript.

#### Exit gate

- TypeScript and Rust agree on every contract fixture.
- `batond` never ACKs before local persistence.
- Restart recovery does not duplicate execution.
- Spawn-after-ACK failure produces `failed`, not a phantom `running` state.
- BATON can run the same demo against MockAgentAdapter or `batond` MockExecutor with equivalent visible state.
- Core BATON still runs without Rust.

---

### Phase 6 — `batond` process supervisor and workspace safety

**Objective:** Move concrete execution reliability responsibilities into Rust.

#### Preconditions

- Phase 4 lifecycle is stable.
- Phase 5 interoperability is green.
- At least one concrete runtime pain justifies this phase.

#### Deliverables

1. Declare Linux as the supported Phase 6 process-supervision platform and add capability checks.
2. Implement server-configured CommandExecutor definitions.
3. Spawn process groups with full-tree cleanup.
4. Stream ordered stdout/stderr chunks through durable per-run files.
5. Enforce bounded buffers and log size policy.
6. Implement heartbeat leases.
7. Implement graceful and forced cancellation.
8. Implement timeout handling.
9. Implement workspace root allowlists, path canonicalization, and symlink-escape rejection.
10. Implement Git mirror/worktree lifecycle.
11. Register artifact manifests.
12. Recover and reconcile active jobs after restart with PID-reuse defense and no blind respawn.
13. Add stale-worktree cleanup.
14. Add chaos tests that kill `batond`, the child process, and callback delivery at critical points.

#### Exit gate

- On Linux, no orphan process remains after cancel, timeout, worker crash, or `batond` restart.
- Unsupported operating systems fail the capability gate instead of claiming equivalent process-tree safety.
- Worktrees are isolated per run.
- Path escape tests fail closed.
- Log order is deterministic by sequence.
- Completion and cancellation races preserve terminal immutability.
- BATON remains the only control-plane database writer.

---

### Phase 7 — Optional Redis adapter, hardening, and production cutover

**Objective:** Add distributed transport only after the HTTP reference path is proven.

#### Deliverables

1. Implement RedisStreamAdapter using the same contracts.
2. Define explicit stream/group naming through configuration.
3. Represent queued, delivered, claimed, ACKed, running, and DLQ states accurately.
4. Implement abandoned-message claiming and idempotent redelivery.
5. Add Redis outage tests.
6. Add production deployment documentation.
7. Add backup/restore runbook.
8. Add service supervision definitions for BATON and `batond`.
9. Add operational dashboards or CLI status summaries.
10. Remove deprecated legacy routes and shims only after confirmed non-use.
11. Complete final public-safe and security review.

#### Exit gate

- HTTP and Redis adapters pass the same adapter contract suite.
- Redis outage does not corrupt control-plane state.
- Production rollback is documented and tested.
- No deprecated route is removed without usage evidence.
- Final security and adversarial suites pass.

---

## 24. Cutover and rollback strategy

### 24.1 Feature flags

```text
BATON_V1_API_ENABLED=true
BATON_LEGACY_API_ENABLED=true
BATON_DISPATCH_ENABLED=false
BATON_REVIEW_ENABLED=false
BATON_BATOND_ENABLED=false
BATON_REDIS_ADAPTER_ENABLED=false
```

Flags are validated configuration, not scattered environment checks.

### 24.2 Rollout order

1. Deploy Phase 0 stabilization.
2. Deploy TypeScript API with legacy routes enabled.
3. Cut browser to typed SDK.
4. Apply v2 database migration with backup.
5. Enable new read model and `why_now`.
6. Enable mock/local dispatch.
7. Enable one HTTP agent endpoint.
8. Enable human review actions.
9. Run `batond` in shadow/demo mode.
10. Route one low-risk executor through `batond`.
11. Expand gradually.
12. Add Redis only when needed.

### 24.3 Rollback rules

- Never roll back by editing terminal records.
- Disable new dispatches first.
- Allow active runs to finish or cancel them explicitly.
- Restore the prior application while retaining the newer database only when schema compatibility is proven.
- For incompatible schema rollback, restore the pre-migration backup and reconcile external agent activity manually.
- Keep artifact data immutable through rollback.

---

## 25. Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| Public mirror is edited while parent repo remains canonical | High | Resolve source-of-truth in Phase 0; implement in canonical source; deterministic sync test. |
| Big-bang TypeScript rewrite breaks parent app | High | Route-by-route port, root shims, API snapshots, separate frontend phase. |
| TypeScript 7 ecosystem transition causes tool failures | Medium | Start on TypeScript 6; evaluate 7 after migration. |
| State-machine complexity slows implementation | Medium | Keep Task, Run, and Dispatch separate; centralized transition maps; adversarial tests. |
| Duplicate dispatch executes work twice | High | Stable logical dispatch ID, per-attempt history, transactional outbox, endpoint dedupe, persisted ACK identity. |
| ACK callback races delivery response | Medium | ACK service accepts sending/delivered states; later receipt is idempotent and cannot regress state. |
| ACK timeout retries while old worker starts late | High | Expire callback token, best-effort cancel/supersede old dispatch, reject late callbacks, require endpoint idempotency. |
| Human queue fills with unusable output | High | Syntax + semantic validation; invalid-output refinement; structured blocker path. |
| Refinement loop never ends | High | Explicit max refinement policy and structured blocked state. |
| Redis becomes accidental source of truth | High | SQLite authoritative; Redis adapter contract only; UI reads BATON state. |
| Rust becomes a second orchestrator | High | Explicit non-responsibilities, resolved-job input only, no ranking/planning code. |
| Rust runtime and TypeScript contracts drift | High | Committed schemas, golden fixtures, cross-language CI. |
| SQLite write contention | Medium | Single API writer, short transactions, WAL, busy timeout, no network calls in transactions. |
| Extension hides startup failure | Medium | Missing-vs-broken distinction; configured extension failure is fatal. |
| Public repo leaks private operational data | High | Move integrations out of core and enforce public-safe CI. |
| Process cancellation leaves children alive | High | Process groups, escalation, confirmation before terminal cancelled state, chaos tests. |
| Callback credentials leak through logs | High | Scoped references, redaction, hashed storage, structured safe errors. |
| Legacy active runs lack ACK data | Medium | Migrate to `lost`; never fabricate history. |

---

## 26. Required architecture decision records

Create these ADRs during the relevant phases:

```text
docs/adr/001-control-plane-execution-plane-split.md
docs/adr/002-contract-first-json-schema.md
docs/adr/003-http-first-dispatch.md
docs/adr/004-sqlite-authoritative-state.md
docs/adr/005-terminal-run-immutability.md
docs/adr/006-typescript-6-migration-baseline.md
docs/adr/007-batond-non-orchestrator-boundary.md
docs/adr/008-public-core-extension-boundary.md
docs/adr/009-archive-is-orthogonal-metadata.md
docs/adr/010-logical-dispatch-and-delivery-attempts.md
docs/adr/011-canonical-source-and-public-mirror.md
```

Each ADR must include context, decision, consequences, rejected alternatives, and supersession rules.

---

## 27. Global definition of done

The roadmap is complete when all of the following are true:

### TypeScript

- API and browser application are strict TypeScript.
- No unvalidated external payload reaches domain logic.
- No route directly mutates task/run/dispatch state.
- Human/API writes use optimistic concurrency.
- Legacy routes are removed or intentionally retained with documented consumers.
- The canonical source and public-mirror sync path are documented and tested.

### Lifecycle integrity

- A run cannot be `running` without a real ACK.
- One task cannot have two active non-terminal runs.
- Terminal runs cannot reopen.
- Retries and refinements create child runs exactly once under replay.
- Logical Dispatches and transport DispatchAttempts remain distinguishable.
- Duplicate and out-of-order events are safe.
- Lease expiry and ACK timeout cannot revive stale work.
- Malformed completion output never enters human review.
- Valid blockers and failures use structured paths.
- Archive/unarchive never rewrites execution status.

### Human review

- Review items include acceptance evidence and artifacts.
- Approve/request-changes/reject decisions are idempotent.
- `why_now` is visible and deterministic.
- The task history explains every transition.

### Rust

- `batond` is optional for core BATON operation.
- `batond` persists before ACK.
- Process cancellation kills the full process tree.
- Worktrees and artifacts are isolated.
- Rust and TypeScript contract fixtures agree.
- `batond` contains no business-priority or planning logic.

### Operations

- Clean local demo works without Redis.
- Rust demo works after Phase 5.
- CI includes contract, migration, public-safe, adversarial, and security checks.
- Backup and rollback procedures are tested.
- Public core contains no private operational values.

---

## 28. Build-agent execution protocol

The build agent must follow this protocol for every phase.

### 28.1 Before coding

1. Read this entire specification.
2. Confirm repository HEAD and compare it to the reviewed baseline SHA.
3. Resolve the canonical source-of-truth repository and mirror/sync topology; do not patch a generated mirror in isolation.
4. Report material drift before implementing.
5. Create a phase-specific branch in the canonical source.
6. Identify the exact phase acceptance criteria.
7. Do not implement later-phase architecture speculatively.

Recommended branch names:

```text
feat/baton-phase-0-stabilize
feat/baton-phase-1-typescript-api
feat/baton-phase-2-typescript-web
feat/baton-phase-3-domain-state
feat/baton-phase-4-dispatch-review
feat/baton-phase-5-batond-skeleton
feat/baton-phase-6-batond-supervisor
feat/baton-phase-7-production-hardening
```

### 28.2 During implementation

- Keep commits narrow and descriptive.
- Add tests with every behavior change.
- Preserve compatibility unless the phase explicitly removes it.
- Do not silence type errors with broad `any`, `@ts-ignore`, or unchecked casts.
- Do not catch and discard errors.
- Do not add dependencies without documenting why existing platform APIs are insufficient.
- Do not embed local host paths, IDs, tokens, or private names.
- Update ADRs when a locked decision changes.

### 28.3 Required phase review packet

At the end of each phase, return:

```markdown
# BATON Phase N Review Packet

## Scope completed
- ...

## Files changed
- ...

## Contract/schema changes
- ...

## Database migrations
- ...

## Tests run
- command: result

## Acceptance criteria
- [x] ...
- [ ] ...

## Evidence
- API snapshots
- test output
- screenshots where applicable
- migration results

## Known risks or intentional deferrals
- ...

## Rollback procedure
- ...

## Recommendation
- approve phase
- request changes
```

The phase is not complete because code exists. It is complete only when the exit gate is proven.

---

## 29. Immediate build instruction: Phase 0

The build agent can begin with the following directive:

> Implement **Phase 0 only** from `baton-typescript-rust-design-spec-v1.1.md`. First compare current `main` to baseline commit `4f25198d831d9ad0c9cd14ddb1fd712e077aeb2f`, determine whether `trippyogi/baton` is the canonical source or a generated mirror of the parent `vector-mission-control`/`baton-core` tree, and report material drift. Do not patch a generated mirror in isolation and do not start the TypeScript port. Make the existing JavaScript application reproducible and testable; repair dependency/config mismatches; inventory every browser API/SSE call and fix the missing Runs/Overview read/live contracts; fix the extension loader so missing and broken extensions are distinguishable; harden webhook HMAC and delivery idempotency; remove hard-coded private/business data from the public core; place private integrations behind a clear extension boundary; add generic fixtures, public-safe auditing, baseline API contract tests, deterministic mirror-sync verification, and CI. Preserve supported API/UI shapes while replacing private fixture values with documented generic equivalents. Stop when the Phase 0 exit gate is satisfied and return the required phase review packet.

---

## 30. Final recommendation

Proceed in this order:

```text
Stabilize current JavaScript
        ↓
Port API to strict TypeScript
        ↓
Port browser to vanilla TypeScript
        ↓
Enforce canonical state and ranking
        ↓
Prove HTTP dispatch + ACK + review + refinement
        ↓
Prove Rust contract interoperability
        ↓
Move only runtime reliability work into batond
        ↓
Add Redis and production hardening when justified
```

The most important constraint is not the language choice. It is preserving the correct operating model:

> BATON should make agent work legible, ranked, dispatchable, auditable, and reviewable. It should not become another agent. Rust should make execution safer, not make the architecture harder to understand.

---

## Appendix A — Reviewed evidence and revalidation rule

This specification was reviewed against the public repository at baseline commit `4f25198d831d9ad0c9cd14ddb1fd712e077aeb2f` and the current official language/runtime release guidance available on 2026-08-07.

### Repository evidence used

| Path/evidence | Observation incorporated into the roadmap |
|---|---|
| `README.md` | Describes BATON as a reusable core loaded from a parent `vector-mission-control` repository with optional internal extensions; prompted the canonical-source/sync gate. |
| `package.json` | Declares only Express and `better-sqlite3` while runtime files import additional packages; prompted Phase 0 dependency reconciliation. |
| `.env.example` and `server/index.js` | `PORT`/`VMC_PORT` mismatch, hard-coded loopback/deployment logging, and extension registration with an undefined `db`; prompted validated config and fail-visible extension loading. |
| `public/js/screens/runs.js`, `public/js/screens/overview.js`, and `server/routes/runs.js` | Browser calls list/detail/SSE run endpoints that the reviewed router does not implement; prompted browser-to-API inventory and Phase 0 parity repair. |
| `server/db.js` and `server/schema.sql` | Inline migrations, JSON-in-text fields, and private/business-specific seeds; prompted explicit migrations, generic fixtures, and the extension boundary. |
| `server/routes/tasks.js` and `server/routes/runs.js` | Direct SQL mutation with no state-machine or optimistic-concurrency guard; prompted centralized domain transitions and immutable terminal states. |
| `server/routes/queue.js` | Redis stream telemetry is treated as queue truth and status labels drift between `success` and `completed`; prompted SQLite-authoritative dispatch state and optional Redis transport. |
| `server/routes/webhook.js` | HMAC, replay, payload validation, and idempotency gaps; prompted raw-body validation, length-safe comparison, delivery dedupe, and repair-run unification. |
| `server/routes/handleJob.js` | Incomplete execution fragment with undefined dependencies; prompted replacement by the adapter contract and optional `batond`, not a TypeScript port of the fragment. |
| Integration/team/memory/creative/shared-request routes | Hard-coded identities, paths, account behavior, and private data; prompted the typed extension and public-safe audit requirements. |

### Toolchain evidence used

- Node.js 24 is an LTS release at the preparation date; the spec therefore uses Node 24 as the preferred runtime baseline.
- TypeScript 6.0 is the stable bridge release on the established JavaScript compiler/API, while TypeScript 7.0 is the new native compiler and does not yet ship a programmatic API. The initial migration therefore pins TypeScript 6 and treats TypeScript 7 adoption as a later isolated decision.
- Rust 1.97.1 is the current stable point release at the preparation date; the Rust workspace pins that toolchain and edition 2024 for reproducibility.

### Revalidation rule

The build agent must treat versions and repository observations as a reviewed baseline, not timeless truth. At the start of each phase it must:

1. Compare repository HEAD and topology to this baseline.
2. Re-run import/dependency and browser/API inventories.
3. Revalidate pinned tool support against the actual lockfile and CI environment.
4. Record any required deviation in the phase review packet and an ADR before changing a locked architectural decision.
