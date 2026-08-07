# Spec quality checklist — control-plane-overhaul

Date: 2026-08-07  
Scope: `spec.md`, `design.md`, constitution, clarifications  
Result: **Pass with amendments applied** (see below)

## Completeness

| Check | Result | Notes |
|---|---|---|
| Primary user & non-goals clear | Pass | Solo operator; batond/Redis/SaaS out |
| User stories have acceptance | Pass | US1–US7 |
| V1 cut line explicit | Pass | Phase 4 |
| BatonTouch ownership boundary | Pass | ADR 003 |
| Canonical sources for every touch kind | Pass | DecisionRequest required |
| Command vs kind distinction | Pass | |
| Migration strategy | Pass after amend | Added Flow→canonical mapping table |
| Ranking algorithm for v1 | Pass after amend | Added touch-rank-v1 sketch in design |
| Strategy packets / other current features | Pass after amend | Explicitly deferred/compat in design |
| Escalation command surface | Pass after amend | Attention endpoint noted |
| Shim removal criteria | Pass after amend | Added to implementation-plan |
| Phase 0 hard gate evidence path | Pass | `phase-0-evidence.md` |

## Consistency

| Check | Result | Notes |
|---|---|---|
| Constitution vs spec vs design | Pass | |
| Demote Flow vs keep BatonTouch | Pass | Flow = thin UI |
| No tenant_id everywhere | Pass | |
| Rank touches not tasks | Pass | |
| Linear lineage vs refinement | Pass | |
| Historical v1.1 conflicts labeled | Pass | `_inputs/` non-authoritative |

## Ambiguity / holes closed this pass

1. **Legacy Flow touch-type → BatonTouchKind mapping** — added to `design.md`.
2. **touch-rank-v1** — deterministic formula sketch added (Phase 3 may tune weights; must stay explainable).
3. **strategy packets** — compatibility/deferral noted; not a v1 canonical entity unless promoted by later clarify.
4. **Escalation** — `POST /touches/:id/escalate` as attention-only; does not change workflow status.
5. **Shim removal criteria** — concrete checklist in implementation-plan.

## Remaining acceptable deferrals (not blockers)

- Exact Zod field lists for every contract (Phase 1/4 packages).
- Full SQLite DDL beyond touches sketch (Phase 3 migrations).
- Playwright scenario scripts (Phase 2/4).
- Measured batond trigger metrics (deferred feature).

## Gate

Spec Kit artifacts are ready for Phase 0 implementation. TypeScript migration remains blocked until Phase 0 hard gate evidence is committed.
