# ADR 004 — Linear run lineage for v1

Status: Accepted  
Date: 2026-08-07

## Decision

Run lineage is linear: one parent run has at most one direct child. Retries and refinements form `run1 → run2 → run3`. Parallel work uses separate tasks, not sibling runs.

## Rationale

Deterministic current-run selection, review supersession, audit, and refinement accounting. DAG execution deferred until a concrete parallel-branch need appears.

## Consequences

- Unique-child guard in domain + tests.
- Request-changes creates exactly one refinement child.
