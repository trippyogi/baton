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

For the operator env/route reference without opening a listener:

```bash
node scripts/nectar-dispatch-bridge.js --help
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

The bridge accepts `baton.dispatch.v1`, writes an ignored local inbox record with `schema_version: baton.nectar_bridge.inbox_record.v1` under `local/nectar-dispatch-inbox/`, and returns an ACK. Inbox writes use create-only semantics so an accidental duplicate dispatch cannot overwrite an existing local prompt; duplicate submissions return HTTP 409 with `rejection_code: duplicate_dispatch` and the existing `inbox_record_name`. Accepted and rejected dispatch responses include stable `schema_version: baton.nectar_bridge.dispatch_result.v1`, `bridge_version`, `bridge_request_id`, and `generated_at`; accepted ACKs echo `dispatch_id`, `run_id`, `task_id`, `touch_id`, `inbox_record_name`, and `prompt_sha256` plus `received_count`/`inbox_record_count` for traceable local logs, while rejections include `rejection_code` and `error_count` for client-side logging. It requires `Content-Type: application/json`, rejects malformed JSON, malformed callback URLs, callback URLs with embedded credentials, and oversized request bodies before writing inbox records, including a fast `Content-Length` preflight when clients provide it; set `NECTAR_BRIDGE_MAX_BODY_BYTES` to a positive integer only if a larger local envelope limit is explicitly needed; invalid values are ignored in favor of the safe default. Its local `/health` endpoint supports GET and HEAD probes; GET includes `health_schema_version`, `bridge_version`, `bridge_instance_id`, `generated_at`, `bind_host`, `dispatch_path`, `dispatch_url`, `token_required`, `bridge_status` (`idle`, `needs_client_fix`, `ready_to_process`, or `blocked_inbox_unwritable`), `started_at`, `uptime_seconds`, `received_count`, `rejected_count`, `inbox_record_count`, `pending_inbox_count`, `pending_inbox_preview_limit`, `first_pending_inbox_name`, `first_pending_inbox_path`, `inbox_dir`, `inbox_record_schema_version`, `inbox_writable`, `last_received_at`, `last_received_request_id`, `last_received_dispatch_id`, `last_received_run_id`, `last_received_task_id`, `last_received_touch_id`, `last_inbox_path`, `last_inbox_name`, `last_prompt_sha256`, `last_rejected_at`, `last_rejection_request_id`, `last_rejection_status`, `last_rejection_reason`, `last_rejection_code`, `last_rejection_errors`, `last_rejection_error_count`, `max_body_bytes`, and `operator_next_check` for quick smoke/debug checks. Accepted ACKs and rejection responses also include `operator_next_check` so local automation can surface the next safe handoff or client-fix step without reinterpreting error codes. It does not execute external actions by itself.

Inbox prompts include a **Local safety** section reminding the receiving agent not to publish private envelope data, callback URLs, tokens, or task context, and to call callbacks only after the corresponding work is actually done.

### Process pending Nectar inbox records

Use the bridge health response as the local handoff queue before asking Nectar to work on a dispatch:

1. Call `GET /health` on the local bridge.
2. If `pending_inbox_count` is greater than `0`, open `first_pending_inbox_path` under this repo.
3. Hand only that record's `prompt` field to the local Nectar/OpenClaw agent.
4. Leave the inbox record private and ignored by Git.
5. Call BATON callbacks only after the corresponding local work actually completes.

If `bridge_status` is `needs_client_fix`, fix `last_rejection_errors` in the dispatch client before retrying. If it is `blocked_inbox_unwritable`, fix the local inbox path/permissions before sending more work.

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

## Run the private workflow checks

Before committing or opening a PR, run the combined private/local safety gate:

```bash
npm run check:private
```

This runs the private-data audit and dry-runs both public-safe local profile fixtures, including the Nectar bridge agent fixture. Use the narrower audit directly when you only need the repository privacy scan:

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

It also rejects syntactically valid but non-object JSON bodies (for example `null` or arrays) with HTTP 400 before validation, so malformed dispatches cannot crash the local bridge.


### Nectar bridge health auth signal

The local Nectar dispatch bridge `/health` response includes `token_required` so operators can confirm whether `NECTAR_DISPATCH_TOKEN` is active before sending private local dispatch envelopes.


## Nectar bridge inbox lookup

The local Nectar bridge health and accepted ACK payloads include `pending_inbox_paths`, `pending_inbox_preview_limit`, plus the first/oldest pending inbox name/path (`first_pending_inbox_*` and `pending_inbox_oldest_*`). Use these ignored local paths to hand a dispatch prompt to Nectar/OpenClaw without guessing filenames; if `pending_inbox_overflow_count` is non-zero, process or archive older local inbox records before relying only on the preview list.
