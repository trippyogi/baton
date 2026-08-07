# ADR 009 — Control plane / execution plane split

Status: Accepted  
Date: 2026-08-07

## Decision

TypeScript owns control-plane state, ranking, review, and touch projection. Optional later Linux `batond` owns process supervision, leases, worktrees, and log capture when used. HTTP contracts are shared; batond never writes BATON SQLite directly and never ranks or approves work.

## Consequences

- Matches historical design intent with v1 cut before daemon implementation.
- Spectre/OpenClaw/Hermes remain reasoning/orchestration outside BATON.
