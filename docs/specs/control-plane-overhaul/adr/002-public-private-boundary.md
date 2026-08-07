# ADR 002 — Public core vs private operator boundary

Status: Accepted  
Date: 2026-08-07

## Decision

Public BATON owns generic control-plane contracts, domain model, and demo fixtures. Personal/business credentials, paths, prompts, integrations, and operator data stay outside the public core (ignored local files, local DB, private extensions). Enforced from Phase 0 as architectural constitution, not deferred cleanup.

## Consequences

- CI public-safe audit is a release gate.
- Private local use docs remain first-class.
- Business-specific routes do not land in public core.
