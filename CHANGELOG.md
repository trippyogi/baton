# Changelog

BATON follows [Semantic Versioning](https://semver.org/). While the project is pre-1.0, minor versions may include breaking changes and patch versions are reserved for fixes.

## [Unreleased]

### Added

- `BATON_HOST`/`HOST` server bind configuration for private same-tailnet development while keeping localhost as the default.
- Airspace Map columns now have inline add buttons so tasks can be created directly into a selected status without leaving the board.
- Private local use boundary with ignored `local/`/`baton-private/` paths, local profile import, redacted export, and private-data audit scripts.
- Generic `scripts/fixtures/private-local-profile.example.json` fixture for safe local task/agent imports.
- Private local use guide documenting safe local profiles, redacted exports, and pre-PR private-data checks.
- GitHub Actions CI for `npm ci`, `npm test`, `npm run smoke:dispatch`, `npm run audit`, and `npm run audit:private`.
- Spectre seeded as the first webhook-dispatchable orchestrator agent.
- Transport-neutral `baton.dispatch.v1` envelope builder and webhook/manual dispatch adapters.
- Run ACK/status callback endpoints with optional bearer-token protection.
- Fake Spectre local harness and `npm run smoke:dispatch` full-loop test.
- Flexible review packet `sections` and `artifacts` fields.

- `SHARED_REQUESTS_TOKEN` is documented in `.env.example` for optional shared requests.
- Self-contained smoke test harness that starts BATON on a temporary database when `BATON_BASE_URL` is not set.
- `/api/health` endpoint for local checks and smoke-test readiness polling.
- `BATON_DB_PATH` override for isolated test databases.
- Node runtime pin via `.nvmrc` and package engines.

### Changed

- Default empty-database demo seed data now uses generic BATON examples instead of private-looking campaign/content examples.
- Configured delegate/assign/evaluator actions now create runs and dispatch to agents; unconfigured dispatch stays visible instead of faking motion.
- Spectre review packet submission advances linked runs to `review_ready`; accepting review completes linked runs.

- Prepared-only delegate/assign/evaluator actions now park touches outside active Flow instead of resurfacing the same card.
- Idle-agent assignment candidates suppress duplicate generic delegate touches for the same task.
- Idle-agent matching now requires skill/domain fit instead of assigning random work.
- Candidate ranking inputs now preserve zero values and let touch-type defaults override task defaults.
- Domain classification can override default `product` for obvious revenue/code/content/admin/maintenance work.
- Smoke boot failures now print child server logs by default.
- `.env` is loaded before database initialization, and server logs no longer include environment-specific SSH hints by default.

- Flow touches rebuild at startup so seeded work appears immediately without making `GET /api/flow` mutate state.
- Review touch primary actions now use executable `inspect` metadata while the UI labels them as Review.
- Flow UI action availability now comes from backend-provided touch metadata.
- Delegate/assign docs and smoke coverage now explicitly reflect truthful non-running behavior when no dispatcher is configured.

### Fixed

- Review packet creation is transactional for packet/task writes and accepts agent field aliases.
- Task JSON fields validate array shape and malformed stored JSON no longer breaks reads.
- Legacy visible screens escape user/agent text and protocol-validate rendered URLs.
- Removed stale placeholder route code.

## [0.1.0] - 2026-06-13

Initial open-source Next-Touch Engine foundation.

### Added

- Flow Home as the default route at `/#/flow`.
- Ranked next-touch queue with deterministic candidate generation.
- Flow modes and airspace summary.
- Command box for capture, delegate, mode changes, review-next, and next-touch queries.
- `baton_touches`, `flow_settings`, `portfolio_domains`, `review_packets`, `quality_policies`, and `agents` tables.
- `/api/flow`, `/api/touches`, `/api/agents`, and `/api/review-packets` routes.
- Review packet validation and quality gate.
- Agent registry and idle-agent assignment candidates.
- Runs read endpoints and SSE heartbeat stub.
- Smoke test script and npm scripts for syntax, smoke, audit, and test.

### Changed

- Board language updated to Airspace Map terminology.
- Redis queue/webhook integrations degrade cleanly when Redis is unavailable locally.
- `GET /api/flow` is read-safe and does not run destructive rebuilds.
- Delegation/assignment is truthful when no worker dispatch is configured: it prepares work but does not mark tasks/agents running.
- Task delete now soft-archives tasks instead of hard-deleting.
- Project branding updated from legacy Vector Mission Control copy to BATON Flow Ops.

### Fixed

- Missing dependency declarations for `dotenv` and `ioredis`.
- Internal extension routes now load before the SPA fallback.
- Snoozed touches resurface after expiry.
- `passed` generated touches no longer suppress future visible touches.
- Invalid review packets create evaluator/refinement touches.
- Flow command submit refreshes immediately while the textarea remains focused.
- User-controlled output is escaped across Flow-adjacent task, board, and run screens.
- Touch actions are authorized by touch type; non-review touches cannot be accepted as done.
- Webhook signature and payload handling hardened.

### Security

- Dependency audit cleaned to zero known moderate-or-higher production vulnerabilities as of this release.
- Added `SECURITY.md` and contributor security checklist.
