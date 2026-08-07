# ADR 007 — Compatibility window migration

Status: Accepted  
Date: 2026-08-07

## Decision

Migrate existing Flow statuses/touches into the canonical model with a compatibility window. Prefer one-way migration plus compatibility reads/endpoints over prolonged dual-write. Remove shims only after Phases 3–4 parity and migration tests pass.

## Consequences

- Legacy `/api/flow` and `/api/touches` adapters during transition.
- Migration MUST NOT fabricate ACK/review history.
