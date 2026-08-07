# ADR 006 — BATON v1 ends at Phase 4; batond deferred

Status: Accepted  
Date: 2026-08-07

## Decision

First usable release includes TypeScript control plane, canonical domain, BatonTouch, hardened HTTP/Spectre dispatch, and private/local boundary. `batond` is not required. Freeze batond contracts in Phase 4; implement under a later Spec Kit feature (`batond-runtime`) when measured execution pain justifies it. Linux-only when built.

## Consequences

- One Spec Kit feature for Phases 0–4.
- Prevents control-plane overhaul from becoming a runtime rewrite.
- Redis remains post-v1 optional adapter.
