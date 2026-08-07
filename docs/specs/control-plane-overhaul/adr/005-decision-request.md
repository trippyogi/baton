# ADR 005 — DecisionRequest is canonical for decision touches

Status: Accepted  
Date: 2026-08-07

## Decision

Add a small `DecisionRequest` entity in Phase 3. `decision_required` BatonTouches MUST reference it. Decision payload truth does not live on the touch.

## Consequences

- Touch kinds stay aligned with canonical sources.
- Keeps open-ended decisions out of ReviewPacket and TaskBlocker misuse.
