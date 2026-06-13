# Contributing to BATON

Thanks for helping improve BATON.

BATON is intentionally not a generic project-management app. The product center is the **Next-Touch Engine**: a ranked queue of the smallest human touches that unlock valuable agent motion.

## Development setup

```bash
git clone https://github.com/trippyogi/baton.git
cd baton
nvm use
npm install
# BATON currently requires Node 20 for native SQLite install consistency
cp .env.example .env
npm start
```

Open:

```text
http://127.0.0.1:4200/#/flow
```

Redis is optional for local Flow development. Queue screens degrade when Redis is unavailable.

## Checks before opening a PR

```bash
npm test
npm run audit
```

`npm test` runs syntax checks and a self-contained smoke test on an isolated temp database. Set `BATON_BASE_URL` only when you intentionally want to smoke-test an already-running server.

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

1. Flow is the default daily route.
2. Board/Kanban is a secondary map, not the primary work surface.
3. No fake uptime: do not mark work running unless a real run/dispatch exists.
4. Touches are the unit of human attention.
5. Manual human overrides should survive refreshes.
6. Review touches require valid review packets.
7. Unsafe actions must be blocked by touch type.

## Security and privacy

Never commit:

- `.env`
- SQLite DB files under `data/`
- logs with private data
- API tokens
- private `baton-internal` extension code
- webhook secrets or worker tokens

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
