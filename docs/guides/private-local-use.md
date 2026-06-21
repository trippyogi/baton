# Private local use

BATON is designed to be useful with real tasks and real agents while the public repository stays safe to publish.

Use this guide when you want to run BATON with private operator data on your own machine.

## Boundary model

Tracked public repository files should contain only:

- product code
- generic docs
- generic fixtures
- tests and smoke scripts
- public-safe examples

Private operator state should live only in:

- ignored `local/` files
- ignored `baton-private/` files
- ignored local SQLite databases under `data/`
- environment variables in `.env`

Do not commit real task lists, agent webhook URLs, tokens, local DBs, logs, screenshots with sensitive data, or private dispatch configuration.

## Ignored private locations

BATON ignores these paths by default:

```text
local/
baton-private/
*.local.json
*.private.json
exports/redacted-*.json
exports/redacted-*.md
data/vmc.db*
.env
*.log
```

Recommended private profile path:

```text
local/profile.json
```

## Create a local profile

Start from the public example:

```bash
mkdir -p local
cp scripts/fixtures/private-local-profile.example.json local/profile.json
```

Then edit `local/profile.json` with your real tasks and agents.

The profile uses this schema marker:

```json
{
  "schema_version": "baton.local_profile.v1",
  "tasks": [],
  "agents": []
}
```

Tasks require only `title`. Agents require `id` and `name`.

For dispatch secrets, store environment variable names in the profile, not raw secret values:

```json
{
  "dispatch_enabled": true,
  "dispatch_transport": "webhook",
  "dispatch_target": "MY_AGENT_WEBHOOK_URL",
  "dispatch_config": {
    "url_env": "MY_AGENT_WEBHOOK_URL",
    "token_env": "MY_AGENT_DISPATCH_TOKEN"
  }
}
```

Put the real values in `.env`, which is ignored by Git.

## Validate without changing the DB

Run a dry run first:

```bash
npm run import:local -- local/profile.json --dry-run
```

The importer validates shape, statuses, priorities, domains, agent slugs, dispatch targets, and obvious secret-looking values. It fails closed on unknown fields so private mistakes do not silently land in your DB.

## Import into the local DB

Import into the default local SQLite DB:

```bash
npm run import:local -- local/profile.json
```

Or target a specific DB with `BATON_DB_PATH`:

```bash
BATON_DB_PATH=/tmp/baton-private-test.db npm run import:local -- local/profile.json
```

By default, import mode is `insert`: duplicate task titles or duplicate IDs fail. To update existing agents/tasks by ID, use:

```bash
npm run import:local -- local/profile.json --mode upsert
```

## Create local agents in the UI

After starting BATON, open Team and use **New local agent** for quick safe registry entries. Use **Edit safe config** on an agent card to update name, type, skills, and dispatch status later.

For webhook dispatch, enter an environment variable name such as `MY_AGENT_WEBHOOK_URL`. Do not paste raw webhook URLs or tokens into the UI. Store real values in `.env` or your private runtime environment.

The Team screen reads `/api/agents`, so imported private agents and UI-created local agents appear in the same registry.

## Prepare a task for a specific agent

Open Airspace Map, click a task, choose a target agent in **Dispatch prep**, then click **Prepare / reuse**.

BATON creates or reuses a `baton.dispatch.v1` envelope for that task/agent without launching anything. This is useful for checking private context and handoff shape before live dispatch.

## Local Nectar bridge

For a local Nectar handoff smoke test, start the local bridge:

```bash
NECTAR_DISPATCH_TOKEN=change-me npm run bridge:nectar
```

Then import the public-safe Nectar fixture:

```bash
npm run import:local -- scripts/fixtures/nectar-local-agent.example.json --mode upsert
```

The fixture stores only env var names. Put real values in `.env` or your private runtime environment:

```bash
NECTAR_WEBHOOK_URL=http://127.0.0.1:4310/baton/dispatch
NECTAR_DISPATCH_TOKEN=change-me
```

The bridge accepts `baton.dispatch.v1`, writes an ignored local inbox record under `local/nectar-dispatch-inbox/`, and returns an ACK. It rejects malformed JSON and oversized request bodies before writing inbox records; set `NECTAR_BRIDGE_MAX_BODY_BYTES` only if a larger local envelope limit is explicitly needed. It does not execute external actions by itself.

Run the bridge smoke test with:

```bash
npm run smoke:nectar
```

## Start BATON

```bash
npm start
```

Open:

```text
http://127.0.0.1:4200/#/flow
```

## Export redacted debug data

If you need to share local state for a bug report, create a redacted export:

```bash
npm run export:redacted
```

Optional details:

```bash
npm run export:redacted -- --include-agents --include-runs
npm run export:redacted -- --format markdown
npm run export:redacted -- --output exports/redacted-bug-report.json
```

Redacted exports preserve statuses, priorities, domains, risk levels, counts, ranks, and dispatch state while removing titles, descriptions, owners, dispatch targets, dispatch configs, payloads, and freeform output.

Generated redacted exports are ignored by Git. Inspect before sharing anyway.

## Run the private-data audit

Before committing or opening a PR, run:

```bash
npm run audit:private
```

The audit checks for:

- blocked private paths tracked by Git
- blocked private paths staged for commit
- high-signal secret values in tracked files
- private-specific content in public fixtures
- required security/private-use docs

Run the normal gates too:

```bash
npm test
npm run smoke:dispatch
npm run audit
npm run audit:private
```

## Safe bug-report flow

1. Reproduce locally.
2. Run `npm run export:redacted`.
3. Run `npm run audit:private`.
4. Inspect the redacted export manually.
5. Share only the redacted export and reproduction steps.

Never paste `.env`, `local/profile.json`, raw SQLite rows, logs with private tasks, webhook URLs, or dispatch tokens into public issues.

## Reset local demo DB

If you only want to reset local demo state, stop BATON and remove the ignored DB files:

```bash
rm -f data/vmc.db data/vmc.db-shm data/vmc.db-wal
```

On Windows PowerShell:

```powershell
Remove-Item data/vmc.db,data/vmc.db-shm,data/vmc.db-wal -ErrorAction SilentlyContinue
```

The next `npm start` recreates the schema and generic demo data.
