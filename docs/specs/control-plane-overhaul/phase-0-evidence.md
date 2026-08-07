# Phase 0 evidence — repository authority & baseline gaps

Date: 2026-08-07  
Commit baseline before Phase 0 code: `512b528` (Spec Kit artifacts)  
Repo HEAD at evidence drafting: see git log after this file lands.

## T0.1–T0.2 Canonical repository hard gate

| Check | Result |
|---|---|
| `git remote -v` | Only `origin` → `https://github.com/trippyogi/baton.git` |
| `.gitmodules` | Absent |
| `git submodule status` | No submodules |
| GitHub `parent` / `source` / `fork` | `fork: false`, `parent: null`, `source: null` |
| In-repo sync scripts for `vector-mission-control` / `baton-core` | **None** outside historical `_inputs/` and Spec Kit docs describing the old risk |
| Current README parent-load language | **Absent** (already superseded by product README); constitution + this evidence make canonical status explicit |

**Conclusion:** `trippyogi/baton` is the canonical repository. No parent/subtree/mirror overwrite path was found. TypeScript migration is **unblocked** with respect to ADR 001, provided this evidence remains true (no future sync automation may be added without a new ADR).

## T0.4 Residual gaps vs historical v1.1 Phase 0

Many historical Phase 0 items are already done on `main` (deps `dotenv`/`ioredis`, Runs read/SSE stubs, webhook hardening, nonlocal API auth, private audit scripts, smoke/dispatch tests, CI).

| Residual | Treatment in this Phase 0 pass |
|---|---|
| Extension loader hides all load/register failures | **Fixed:** missing extension optional; broken extension fails startup |
| README examples use `MetaTravelers` | **Fixed:** generic example copy |
| Product docs still center “Flow engine” vs constitution | **Fixed:** README/CONTRIBUTING point at Spec Kit; Flow demoted to thin UI language |
| `PORT` vs `VMC_PORT` dual read | Accepted for compatibility; validated single config belongs to Phase 1 |
| Business routes (creatives/memory/team) still in core | Documented; full quarantine is phased with extension boundary — no silent delete in Phase 0 |
| Node 20 pin | Intentional until Phase 1 (ADR 008 moves to 24) |

## T0.5 Public/private boundary

- `npm run audit:private` remains CI-required.
- Constitution ADR 002 is authoritative.
- Prior draft `docs/specs/private-local-use-boundary.md` principles absorbed; treat as historical until fully reconciled.

## T0.7 Verification

Recorded 2026-08-07 on Node 20.20.2 (`nvm use` / `.nvmrc`):

- `npm test` — pass (`check:js` + `smoke-flow`)
- `npm run smoke:dispatch` — pass
- `npm run audit` — pass at `--audit-level=moderate` (1 low `body-parser` advisory noted; not a Phase 0 blocker)
- `npm run audit:private` — pass (Spec Kit paths allowlisted for public repo identity; historical input scrubbed of private project markers)

## Exit gate

- [x] Canonical-repo evidence recorded
- [x] No overwrite path found
- [x] README/CONTRIBUTING supersede parent topology and link Spec Kit
- [x] Extension missing vs broken distinguished
- [x] Residual public-example leak cleaned
- [x] Checks green

**Phase 1 may begin.** TypeScript migration remains gated only by normal PR review, not by repository-authority uncertainty.
