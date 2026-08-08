# Contributing to BATON

Thanks for helping improve BATON.

**Canonical repository:** `trippyogi/baton` is the source of truth. Do not assume a parent `vector-mission-control` / `baton-core` sync will overwrite this tree.

BATON is intentionally not a generic project-management app. The product center is the ranked **BatonTouch** attention queue. Workflow truth lives in Task / Run / Dispatch / Review / Blocker / DecisionRequest; touches are durable attention projections. See `.specify/constitution.md` and `docs/specs/control-plane-overhaul/`.

## Development setup

```bash
git clone https://github.com/trippyogi/baton.git
cd baton
nvm use
npm install
# BATON requires Node 24 for the TypeScript control-plane toolchain
cp .env.example .env
npm start
```

Open:

```text
http://127.0.0.1:4200/#/flow
```

`npm start` boots `apps/api/bootstrap.cjs` (validated port/host, then the current server). Zod config schemas live in `@baton/contracts` and are unit-tested; they are not loaded into the SQLite process on Windows yet because that combination has been unstable under Node 24. `npm run start:legacy` still runs `server/index.js` directly.

Redis is optional for local Flow development. Queue screens degrade when Redis is unavailable.

## Checks before opening a PR

```bash
npm test
npm run smoke:dispatch
npm run audit
npm run audit:private
```

`npm test` runs syntax checks and a self-contained smoke test on an isolated temp database. Set `BATON_BASE_URL` only when you intentionally want to smoke-test an already-running server. `npm run audit:private` checks that private local data, ignored DB state, and high-signal secrets are not tracked.

## Commit style

Use small, focused commits. Prefer prefixes when useful:

```text
server: add runs read endpoint
flow: fix snooze lifecycle
ui: escape task titles
security: harden webhook signature handling
docs: update release checklist
```

Do not combine state-machine changes with styling-only changes.

## Product invariants

Changes should preserve these invariants:

1. The ranked touch queue is the default daily surface (Flow UI is a thin client over touches).
2. Board/Kanban is a secondary map, not the primary work surface.
3. No fake uptime: do not mark work running without a real ACK’d run/dispatch.
4. Touches are the unit of human attention; they must not independently own task/run/review truth.
5. Manual human overrides (snooze, rank boost, mode hints) should survive refreshes.
6. Review touches require valid review packets.
7. Unsafe actions must be blocked by touch type / domain command rules.
8. Public core stays free of private operator credentials, paths, and business-specific seed data.

## Security and privacy

Never commit:

- `.env`
- SQLite DB files under `data/`
- ignored `local/` or `baton-private/` files
- generated redacted exports under `exports/`
- logs with private data
- API tokens
- private extension code
- webhook secrets or worker tokens

If you want to use BATON with real personal or company tasks, keep them in ignored local files and follow `docs/guides/private-local-use.md`.

If you find a security issue, follow `SECURITY.md` instead of opening a public issue.

## Pull request checklist

- [ ] Product invariant still holds.
- [ ] State transitions are truthful.
- [ ] User-controlled strings are escaped in UI.
- [ ] New endpoints validate input.
- [ ] Docs updated if behavior changed.
- [ ] CHANGELOG updated for user-visible changes.
- [ ] `npm run check:js` passes.
- [ ] `npm run smoke` passes against a running server.
- [ ] `npm run audit` passes or exception is documented.
- [ ] `npm run audit:private` passes.
