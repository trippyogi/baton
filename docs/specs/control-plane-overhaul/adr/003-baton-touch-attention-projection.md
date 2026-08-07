# ADR 003 — BatonTouch as durable attention projection

Status: Accepted  
Date: 2026-08-07

## Decision

BatonTouch is persisted as a first-class human-attention entity and materialized from canonical workflow state. It owns queue identity and attention lifecycle fields (seen, snooze, assignee, escalation, rank override, resolution metadata). It does not own task, execution, review, blocker, or decision truth.

Domain commands update canonical entities first; touch resolution happens in the same transaction. Generic touch status mutation cannot complete workflow work.

## Rationale

- Pure joins cannot preserve attention lifecycle or stable IDs for audit/notifications/clients.
- Authoritative touches duplicate domain state and create drift.
- BATON’s differentiator is the ranked attention queue, not a task dashboard.

## Consequences

- Every touch references source type/id/version and a dedupe key.
- Projection is synchronous and idempotent for v1.
- Rank BatonTouch, not Task.
- No `tenant_id`; no notification fields on touch (future `TouchDelivery`).
- `DecisionRequest` required for `decision_required` kind.
- Flow modes demoted to soft hints (`workMode`).
