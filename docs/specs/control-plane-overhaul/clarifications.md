# Clarifications log — control-plane-overhaul

Date: 2026-08-07

| # | Decision |
|---:|---|
| 1 | Demote Flow UI/engine; center Task/Run/Dispatch; keep attention queue via BatonTouch |
| 2 | BatonTouch = durable materialized attention projection (not independent workflow aggregate, not ephemeral join) |
| 3 | Primary user = solo operator |
| 4 | `trippyogi/baton` canonical; Phase 0 proves no external overwrite |
| 5 | Milestone 1 = TS + domain + BatonTouch + HTTP/Spectre + private boundary; not batond |
| 6 | Private/local boundary in constitution + Phase 0 |
| 7 | Compatibility window migration; avoid prolonged dual-write |
| 8 | Linear run lineage for v1 |
| 9 | DecisionRequest in Phase 3 |
| 10 | batond optional until measured pain; freeze contracts in Phase 4 |
| 11 | batond Linux-only when built |
| 12 | Node 24 in Phase 1 |
| 13 | Authoritative artifacts in-repo; freeze Downloads v1.1 under `_inputs/` |
| 14 | One Spec Kit feature for Phases 0–4; batond later |
| 15 | No `tenant_id` in v1 |
| 16 | Flow modes → nullable soft `workMode` hints only |
| 17 | No notification fields on BatonTouch; future `TouchDelivery` |

V1 cut line: end of Phase 4.
