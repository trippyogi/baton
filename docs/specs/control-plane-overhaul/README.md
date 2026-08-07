# Control-plane overhaul

Spec Kit feature for **BATON v1** (Phases 0–4).

| Artifact | Role |
|---|---|
| [spec.md](./spec.md) | What / why (product) |
| [design.md](./design.md) | How (architecture) |
| [implementation-plan.md](./implementation-plan.md) | Phased plan + exit gates |
| [tasks.md](./tasks.md) | Dependency-ordered tasks |
| [adr/](./adr/) | Architecture decisions |
| [../../_inputs/](../_inputs/) | Frozen historical design input (non-authoritative) |
| [../../../.specify/constitution.md](../../../.specify/constitution.md) | Project constitution |

**Baseline for planning:** `2adc35b` on `main`. Revalidate before implementation.

**V1 cut line:** Phase 4. `batond` is a later feature (`batond-runtime`).

**Clarifications locked:** 2026-08-07 (canonical repo, milestone scope, BatonTouch projection model, linear lineage, DecisionRequest in Phase 3, Node 24, no tenant_id, modes as soft hints, no touch notification fields).
