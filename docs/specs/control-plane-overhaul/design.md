# Control-plane overhaul — Design

Status: Accepted  
Implements: `spec.md`  
Historical detail: `docs/specs/_inputs/baton-ts-rust-design-spec-v1.1.md` (non-authoritative; use when this design is silent and constitution allows)

---

## 1. Architecture

```text
Operator UI (vanilla TS)
        │
        ▼
BATON TypeScript control plane
  domain services + SQLite (authoritative)
  BatonTouch projection (same transactions)
        │ versioned JSON contracts
        ▼
HTTP / Spectre / mock agents
        │
        ▼  (later feature: batond-runtime)
   optional Linux batond
```

**Principles:** contracts precede transport; control plane is authoritative; Rust never ranks or approves.

## 2. Technology (Phase 1+)

| Area | Choice |
|---|---|
| Runtime | Node.js **24** (pin `engines`, `.nvmrc`, CI) |
| Language | TypeScript 6.x strict; evaluate TS 7 after green |
| API | Express 4 during port; Express 5 only as isolated follow-up |
| Validation | Zod → committed JSON Schema in `packages/contracts` |
| DB | SQLite via `better-sqlite3` + repositories |
| Web | Vite + vanilla TypeScript (no React) |
| Tests | Vitest + Supertest + Playwright critical flows |
| Redis | Optional adapter after v1 |
| batond | Deferred; Linux-only when built; contracts frozen in Phase 4 |

Target layout (incremental, not big-bang):

```text
apps/api  apps/web  packages/contracts  packages/sdk  db/migrations
```

Root shims preserve `npm start` until cutover.

## 3. Domain ownership

See constitution §4. Summary: workflow entities own truth; BatonTouch owns attention lifecycle only.

### 3.1 DecisionRequest (Phase 3)

Small canonical entity for open-ended decisions:

- question / context
- options (optional)
- requester
- status (`open` | `answered` | `cancelled`)
- response payload
- timestamps + `version`

Creates `decision_required` touches. Touches MUST NOT store the decision payload as authoritative truth.

### 3.2 BatonTouch

**Definition:** durable, ranked request for human attention, materialized from canonical workflow state. Points at the entity requiring action, explains why now, owns only the attention request lifecycle.

```ts
export type BatonTouchKind =
  | 'review_required'
  | 'blocker_resolution_required'
  | 'decision_required'
  | 'assignment_required'
  | 'prioritization_required'
  | 'capture_triage_required'

export type BatonTouchStatus =
  | 'open'
  | 'snoozed'
  | 'resolved'
  | 'superseded'
  | 'cancelled'

export type BatonTouchSource =
  | { type: 'review_packet'; id: string; version: number }
  | { type: 'task_blocker'; id: string; version: number }
  | { type: 'decision_request'; id: string; version: number }
  | { type: 'task_assignment'; id: string; version: number }
  | { type: 'task_prioritization'; id: string; version: number }
  | { type: 'triage_task'; id: string; version: number }

export interface BatonTouch {
  id: string
  kind: BatonTouchKind
  source: BatonTouchSource
  taskId: string | null
  runId: string | null
  status: BatonTouchStatus
  assigneeId: string | null
  seenAt: string | null
  snoozedUntil: string | null
  rankScore: number
  rankExplanation: RankExplanation
  manualRankOverride: number | null
  workMode: string | null // soft hint only
  openedAt: string
  dueAt: string | null
  escalatedAt: string | null
  resolvedAt: string | null
  resolvedBy: string | null
  resolutionEventId: string | null
  sourceEventId: string
  dedupeKey: string
  openedSnapshot: Record<string, unknown>
  createdAt: string
  updatedAt: string
  version: number
}
```

No `tenant_id` in v1. No notification bookkeeping on the touch; future `TouchDelivery` entity when channels exist.

**Owns:** id, status, assignee, seen, snooze, due/escalation, manual rank override, resolution metadata, source ref/version, dedupe key.

**May materialize (recomputable):** rank, why_now, display title/summary, suggested actions, source status, opened snapshot.

**Must never own:** task/run/review/blocker/decision/artifact/execution truth.

### 3.3 Command flow

Wrong: `PATCH /touches/:id { status: "resolved" }` as a way to finish work.

Right:

```http
POST /api/v1/reviews/:id/decisions
{ "decision": "approve", "expectedVersion": 3, "touchId": "…" }
```

Transaction: validate review + touch source version → write ReviewDecision → advance task/run → event → resolve touch → commit.

Attention-only endpoints:

```text
GET  /api/v1/touches
GET  /api/v1/touches/:id
POST /api/v1/touches/:id/seen
POST /api/v1/touches/:id/snooze
POST /api/v1/touches/:id/unsnooze
POST /api/v1/touches/:id/assign
POST /api/v1/touches/:id/claim
POST /api/v1/touches/:id/rank-override
POST /api/v1/touches/:id/escalate
```

### 3.4 Materialization

Synchronous, idempotent projection in the same SQLite transaction as canonical writes. Async projector not required for v1; projection service MUST remain rebuildable for source-derived fields while preserving touch-owned human fields.

Dedupe key examples:

```text
review_packet:{id}:v{version}
task_blocker:{id}:v{version}
decision_request:{id}:v{version}
```

**Supersede vs resolve:** human `request_changes` resolves the review touch via ReviewDecision; the new packet opens a new touch. Use `superseded` when a newer source version appears without a direct human resolution of the prior touch.

### 3.5 Persistence sketch

```sql
CREATE TABLE baton_touches (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_version INTEGER NOT NULL,
  task_id TEXT,
  run_id TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  assignee_id TEXT,
  seen_at TEXT,
  snoozed_until TEXT,
  rank_score REAL NOT NULL DEFAULT 0,
  rank_explanation_json TEXT NOT NULL DEFAULT '{}',
  manual_rank_override REAL,
  work_mode TEXT,
  opened_at TEXT NOT NULL,
  due_at TEXT,
  escalated_at TEXT,
  resolved_at TEXT,
  resolved_by TEXT,
  resolution_event_id TEXT,
  source_event_id TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  opened_snapshot_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (task_id) REFERENCES tasks(id),
  FOREIGN KEY (run_id) REFERENCES runs(id)
);
```

## 4. Ranking

Rank **BatonTouch**. Task fields are inputs.

Persist `RankExplanation` when presented. Recalculation MUST NOT erase auditability of what the operator saw (`openedSnapshot`).

Historical task `rank-v1` formula in the v1.1 input is **superseded** as the queue algorithm.

### 4.1 touch-rank-v1 (default)

Inputs are integers 0–10 unless noted. `ageHours` is hours since `openedAt`. `manualRankOverride` if set replaces the computed score (still explained).

```text
kind_weight =
  review_required: 10
  blocker_resolution_required: 9
  decision_required: 8
  assignment_required: 6
  prioritization_required: 5
  capture_triage_required: 4

raw_score =
  kind_weight * 3
+ (task.impact ?? 5) * 4
+ (task.urgency ?? 5) * 3
+ readiness_bonus          # 10 if deps satisfied else 0; weight * 2
+ min(ageHours, 72) / 8    # gentle aging up to +9
+ (touch.escalatedAt ? 15 : 0)
- (task.effort ?? 5)
+ workMode_bias            # -2..+2 soft hint only
+ (manualRankOverride ?? 0)  # if using additive override mode

rank_score = clamp(raw_score, 0, 200)
```

Ordering: highest `rank_score`, then earliest `dueAt`, then oldest `openedAt`, then stable `id`.

Phase 3 MAY tune weights but MUST keep deterministic explanations and regression fixtures.

## 4.2 Legacy Flow touch mapping

One-way migration into BatonTouch kinds (compatibility adapters may still expose old type strings):

| Legacy Flow / touch concept | v1 kind | Notes |
|---|---|---|
| review / approve packet | `review_required` | Only if valid ReviewPacket exists; else diagnostic + no review touch |
| blocker / waiting / needs input | `blocker_resolution_required` | Requires TaskBlocker row |
| decide / strategy choice | `decision_required` | Requires DecisionRequest; strategy-packet UI may create one |
| delegate / assign / idle agent | `assignment_required` | Source = task assignment gap |
| reprioritize / boost ask | `prioritization_required` | Rare |
| capture / inbox triage | `capture_triage_required` | Raw text → triage Task first |
| refine / evaluate invalid packet | Not a kind | Invalid output → refinement Run; may yield later review touch |
| archive / snooze / escalate | Not kinds | Commands on Task or attention endpoints |

## 4.3 Strategy packets

Current `strategy-packets` routes are **compatibility surface** in v1. They MUST NOT become a second workflow aggregate. Prefer: strategy packet → Task and/or DecisionRequest → touch projection. Promoting StrategyPacket to a canonical entity requires a new clarify/ADR.

## 4.4 Escalation

`POST /api/v1/touches/:id/escalate` is attention-only: sets `escalatedAt` / boosts rank. It MUST NOT change Task/Run status.

## 5. State machines

Adopt Task/Run/Dispatch machines from the historical design input **as amended by constitution**:

- Linear run lineage only
- Archive orthogonal to TaskStatus
- One active non-terminal run per task
- ACK required before `running`
- Outcome→task side effects transactional with touch projection

Legacy Flow status/touch mapping belongs in migration (see implementation plan). Prefer adapters over dual-write.

## 6. Dispatch

- HTTP/webhook reference adapter + Spectre path hardened in Phase 4
- Logical Dispatch + DispatchAttempt rows
- Out-of-band callback credentials (not inside persisted envelope)
- Mock agent for Redis-free demo
- Freeze batond HTTP contract shapes in Phase 4 without implementing the daemon

## 7. Security

- Loopback default; external bind requires auth
- Webhook HMAC length-safe compare + delivery dedupe
- SSRF controls on configured endpoints
- Public-safe CI scanner
- No secrets in events/review packets

## 8. Compatibility

- Migrate existing Flow touches/statuses into canonical + BatonTouch tables
- Legacy `/api/flow`, `/api/touches` shapes served by adapters reading canonical state
- Remove shims only after Phase 3–4 parity tests

## 9. What batond must not know

Runtime emits execution facts only. TypeScript decides whether facts create/resolve touches. Ranking and review stay out of Rust.
