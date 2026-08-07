# ADR 001 — Canonical repository authority

Status: Accepted  
Date: 2026-08-07

## Decision

`trippyogi/baton` is the canonical source of truth. Any parent/subtree/mirror overwrite path MUST be eliminated or proven absent in Phase 0 before TypeScript migration.

## Rationale

Historical topology described BATON as loaded from a parent `vector-mission-control` / `baton-core` tree. Evolving a mirror that can be overwritten destroys Spec Kit artifacts and migration work.

## Consequences

- Phase 0 hard gate with written evidence.
- README/CONTRIBUTING supersede parent-load language.
- Spec artifacts live in this repo.
