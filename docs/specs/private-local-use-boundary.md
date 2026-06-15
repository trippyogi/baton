# BATON Private Local Use Boundary Build Spec

Status: Draft for next build pass  
Target branch: `build/private-local-use-boundary`  
Primary goal: let an operator use BATON with real private tasks and agents locally while keeping the open-source repository safe, generic, maintainable, and free of sensitive data.

## 1. Context

BATON is becoming useful enough for real operator work. The next risk is not product complexity; it is boundary management.

We need Jeremy to be able to run BATON with his own real tasks, real agent names, private dispatch URLs, private workflows, and local SQLite state without those details leaking into:

- Git commits
- public issues or bug reports
- test fixtures
- screenshots/logs
- generated exports
- default seed data
- CI artifacts
- future open-source examples

The public project should remain a clean, generic Next-Touch Engine. Private operator data should be loaded from ignored local files or local runtime state.

## 2. Product intent

This build pass should make BATON safe to actually use every day.

The operator should be able to answer:

- What real work needs my attention?
- Which real agent can take the next step?
- What private context does that agent need?
- Can I import/export/reproduce local state without accidentally publishing private details?

The open-source contributor should be able to answer:

- How do I run BATON with sample data?
- How do I use my own private data safely?
- What files should never be committed?
- What checks protect the repo before release or PR?

## 3. Non-goals

This pass must not become a broad agent automation rebuild.

Do not build:

- a hosted multi-user auth system
- cloud sync
- account management
- public SaaS deployment assumptions
- automatic GitHub issue filing with private task content
- autonomous public posting
- secret storage beyond environment variables and ignored local files
- deep UI redesign unrelated to local/private use
- a complex plugin framework

Keep the implementation small, boring, file-backed, testable, and local-first.

## 4. Core principle

Public repository contains product code, generic examples, docs, tests, and demo seeds.

Private operator state lives in ignored local files and local databases.

No private state should be required for the public test suite.

No public example should look like Jeremy's actual tasks, businesses, agents, private repos, tokens, or personal notes.

## 5. Current state

BATON already has important safety foundations:

- `.env` is ignored.
- SQLite DB files under `data/` are ignored.
- `SECURITY.md` documents private reporting and release security expectations.
- `CONTRIBUTING.md` tells contributors not to commit `.env`, DB files, logs, API tokens, private extension code, webhook secrets, or worker tokens.
- Smoke tests use isolated temp DBs when `BATON_BASE_URL` is unset.
- Dispatch is truthful: unconfigured agents stay visible and do not fake running state.
- Webhook signing and payload handling have been hardened.
- `npm test`, `npm run smoke`, `npm run smoke:dispatch`, and `npm run audit` exist.

Main gaps:

- No first-class private local profile directory.
- No documented import path for real tasks/agents.
- No redacted export for sharing bug reports or demo state.
- No pre-release private-data audit script.
- Default seed data still contains legacy/project-specific flavor and should be made generic or gated.
- No CI yet to run the current gates on PR/push.

## 6. Proposed build pass summary

Build a "Private Local Use Boundary" consisting of:

1. Ignored private local directory support.
2. Private task import command.
3. Private agent import command or combined local profile import.
4. Redacted export command.
5. Private-data audit command.
6. Public/private usage docs.
7. CI gate for core checks.

The work should be implemented as public OSS infrastructure, not Jeremy-specific configuration.

## 7. Files and directory model

### 7.1 Public tracked files

Recommended tracked additions:

```text
docs/guides/private-local-use.md
docs/specs/private-local-use-boundary.md
scripts/import-local-profile.js
scripts/export-redacted.js
scripts/audit-private-data.js
scripts/fixtures/private-local-profile.example.json
.github/workflows/ci.yml
```

`docs/specs/private-local-use-boundary.md` is this spec.

### 7.2 Ignored private files

Update `.gitignore` to include:

```text
local/
baton-private/
*.local.json
*.private.json
exports/redacted-*.json
exports/redacted-*.md
```

Keep existing ignores:

```text
node_modules/
data/vmc.db
data/vmc.db-shm
data/vmc.db-wal
.env
*.log
.DS_Store
```

Add `exports/.gitkeep` only if an exports directory is desired, but default generated exports should be ignored.

### 7.3 Recommended private profile path

Default private profile file:

```text
local/profile.json
```

Optional separate files:

```text
local/tasks.json
local/agents.json
local/context-notes.json
```

The first implementation should prefer one profile file because it is easier to validate and document.

## 8. Local profile schema

Implement schema versioning from the start.

Example public fixture:

```json
{
  "schema_version": "baton.local_profile.v1",
  "tasks": [
    {
      "title": "Review launch checklist",
      "description": "Confirm the next required human decision and delegate the follow-up.",
      "status": "ready",
      "priority": "high",
      "owner": "operator",
      "tags": ["launch", "review"],
      "domain": "product",
      "impact_score": 8,
      "effort_score": 2,
      "autonomy_level": 2,
      "risk_level": "medium",
      "human_touch_minutes": 10,
      "agent_hours_unlocked": 2
    }
  ],
  "agents": [
    {
      "id": "example-research-agent",
      "name": "Example Research Agent",
      "type": "research",
      "status": "idle",
      "skills": ["research", "synthesis"],
      "permissions": {
        "github": { "repos": [], "can_push_branch": false, "can_merge": false },
        "spend": { "daily_limit_usd": 0 },
        "external_messages": { "draft_only": true },
        "public_posting": false,
        "production_changes": false
      },
      "dispatch_enabled": false,
      "dispatch_transport": "manual"
    }
  ]
}
```

### 8.1 Required task fields

- `title`

### 8.2 Optional task fields

Allowed fields should mirror the existing Tasks API allowlist:

- `description`
- `status`
- `priority`
- `owner`
- `tags`
- `due_at`
- `linked_run_ids`
- `impact_score`
- `effort_score`
- `domain`
- `project_key`
- `context_key`
- `autonomy_level`
- `risk_level`
- `quality_gate`
- `spec_quality`
- `human_touch_minutes`
- `agent_hours_unlocked`
- `confidence_score`
- `quality_score`
- `fun_score`
- `strategic_optionality`

### 8.3 Required agent fields

- `id`
- `name`

### 8.4 Optional agent fields

Allowed fields should mirror the existing Agents API where safe:

- `type`
- `status`
- `skills`
- `permissions`
- `current_task_id`
- `current_run_id`
- `cost_profile`
- `dispatch_enabled`
- `dispatch_transport`
- `dispatch_target`
- `dispatch_config`
- `quality_score`
- `reliability_score`
- `last_activity_at`

## 9. Import behavior

Add package scripts:

```json
{
  "import:local": "node scripts/import-local-profile.js",
  "export:redacted": "node scripts/export-redacted.js",
  "audit:private": "node scripts/audit-private-data.js"
}
```

### 9.1 Command UX

Default profile path:

```bash
npm run import:local
```

Explicit profile path:

```bash
npm run import:local -- local/profile.json
```

Dry run:

```bash
npm run import:local -- local/profile.json --dry-run
```

Replace/update mode should be explicit:

```bash
npm run import:local -- local/profile.json --mode upsert
```

Recommended modes:

- `insert`: create new records only, fail on duplicate ids or obvious duplicate task titles.
- `upsert`: update existing records by id; for tasks without ids, use insert.
- `dry-run`: validate and show planned inserts/updates without DB mutation.

Initial implementation can support `insert` and `--dry-run` only if scope needs to stay tight.

### 9.2 Database target

Use the existing `BATON_DB_PATH` mechanism.

Examples:

```bash
BATON_DB_PATH=data/vmc.db npm run import:local -- local/profile.json
BATON_DB_PATH=/tmp/baton-test.db npm run import:local -- scripts/fixtures/private-local-profile.example.json --dry-run
```

### 9.3 Validation rules

Fail closed on malformed data.

Task validation:

- `title` must be a non-empty string.
- `status` must be one of existing valid task statuses.
- `priority` must be one of existing valid priorities.
- `risk_level` must be one of existing valid risk levels.
- `domain` must exist in `portfolio_domains`.
- array fields must be arrays of strings.
- numeric fields must be finite numbers and clamped using the same bounds as the API.
- unknown fields should fail by default, not silently pass through.

Agent validation:

- `id` must be a stable slug: lowercase letters, numbers, hyphen, underscore.
- `name` must be a non-empty string.
- `status` must be an existing valid agent status.
- `skills` must be an array of strings.
- `permissions`, `cost_profile`, and `dispatch_config` must be JSON objects.
- if `dispatch_enabled` is true, require explicit transport and target.
- webhook targets must be env var names or localhost URLs by default; reject raw public URLs unless `--allow-external-dispatch-targets` is passed.

Secret detection:

- Reject obvious secrets in profile JSON by default.
- Detect keys or values containing patterns like `api_key`, `token`, `secret`, `password`, `private_key`, `bearer`, `sk-`, `ghp_`, `xoxb-`, long base64-ish strings, PEM blocks.
- Allow env var references such as `SPECTRE_WEBHOOK_URL` or `MY_AGENT_TOKEN_ENV`.
- Do not print raw rejected secret values; print path and reason only.

### 9.4 Import report

After import, print a concise report:

```text
BATON local profile import
profile: local/profile.json
mode: insert
db: data/vmc.db

validated: yes
tasks: 8 planned, 8 inserted, 0 skipped
agents: 2 planned, 2 inserted, 0 skipped
warnings: 1

warnings:
- tasks[3].description is long; consider using context_key for private details.
```

For JSON automation, optionally support:

```bash
npm run import:local -- local/profile.json --json
```

## 10. Redacted export behavior

Add:

```bash
npm run export:redacted
```

Default output:

```text
exports/redacted-YYYYMMDD-HHMMSS.json
```

Options:

```bash
npm run export:redacted -- --format json
npm run export:redacted -- --format markdown
npm run export:redacted -- --output exports/redacted-bug-report.json
npm run export:redacted -- --include-runs
npm run export:redacted -- --include-agents
```

### 10.1 Redaction principles

The export should preserve structure and debugging value while removing private content.

Redact:

- task titles
- descriptions
- owner names except generic owner classes
- dispatch targets
- dispatch configs
- webhook URLs
- tokens/secrets
- context keys if they appear private
- external run ids if they look provider-specific
- freeform output previews

Preserve:

- counts
- statuses
- priorities
- domains
- risk levels
- timestamps rounded to day or relative age where possible
- touch types
- action availability
- score/ranking fields
- schema versions
- validation errors

Example redacted task:

```json
{
  "id": "task_001",
  "title": "[redacted-title]",
  "description": "[redacted-description length=184]",
  "status": "ready",
  "priority": "high",
  "domain": "product",
  "risk_level": "medium",
  "tags": ["[redacted-tag]"],
  "impact_score": 8,
  "effort_score": 2
}
```

### 10.2 Export safety

- Generated exports must be ignored by Git.
- Export command should run `audit:private` on its own output and fail if the redacted export still appears to contain secrets.
- Export should never include `.env` values.

## 11. Private-data audit behavior

Add:

```bash
npm run audit:private
```

This script should be read-only.

Checks:

1. Git tracked files do not include blocked paths:
   - `.env`
   - `data/*.db*`
   - `local/**`
   - `baton-private/**`
   - `exports/redacted-*`
   - `*.log`
2. Git status does not show private ignored files staged for commit.
3. Tracked files do not include obvious secret values.
4. Public fixtures do not include Jeremy-specific names, private repo names, real webhook URLs, personal project names, or local absolute paths.
5. `package-lock.json` is present and in sync after dependency changes.
6. `SECURITY.md`, `CONTRIBUTING.md`, and private-use guide exist.

High-signal secret patterns only. Avoid noisy scans that make the script useless.

Recommended suspicious value patterns:

- `sk-[A-Za-z0-9_-]{20,}`
- `ghp_[A-Za-z0-9_]{20,}`
- `github_pat_[A-Za-z0-9_]{20,}`
- `xox[baprs]-[A-Za-z0-9-]{20,}`
- `-----BEGIN (RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----`
- `AKIA[0-9A-Z]{16}`
- `Bearer [A-Za-z0-9._-]{20,}`

Suspicious key names:

- `api_key`
- `apikey`
- `token`
- `secret`
- `password`
- `private_key`
- `webhook_url`

Allowlist expected documentation mentions, but not value assignments.

### 11.1 Audit output

Human output:

```text
BATON private data audit
tracked blocked paths: ok
staged private paths: ok
secret patterns: ok
public fixture specificity: ok
required docs: ok

result: pass
```

JSON output optional:

```bash
npm run audit:private -- --json
```

## 12. Default seed data cleanup

Current `server/db.js` seeds legacy/project-flavored sample tasks when the tasks table is empty.

This is acceptable for local demo bootstrapping but not ideal for a clean OSS core.

Recommended change:

- Replace seeded tasks with generic BATON demo tasks.
- Keep them obviously fake and non-private.
- Avoid references to real campaigns, brands, internal project names, or dollar amounts that look operational.

Example generic demo seeds:

- `Review agent output packet`
- `Prioritize next product polish task`
- `Draft launch checklist follow-up`
- `Triage stale waiting run`
- `Refine implementation spec for code agent`

Alternatively, gate demo seeds behind:

```bash
BATON_SEED_DEMO=1 npm start
```

But this is a larger behavior change. For this build pass, replacing with generic fake seed data is likely enough.

## 13. Documentation requirements

Create `docs/guides/private-local-use.md`.

It should cover:

- how public BATON differs from private local state
- where to put private files
- example `local/profile.json`
- how to import private tasks/agents
- how to run a dry run
- how to export redacted debug data
- how to run private-data audit
- what never to commit
- how to use env vars for dispatch targets/tokens
- how to prepare a safe bug report
- how to reset local demo DB safely

Add short links from README and CONTRIBUTING.

README addition should be brief:

```md
### Private local use

BATON is safe to run with your own tasks and agents locally. Keep private data in ignored `local/` files or the local SQLite DB, then use `npm run audit:private` before committing. See `docs/guides/private-local-use.md`.
```

CONTRIBUTING addition:

```md
Before opening a PR, run `npm run audit:private` in addition to test/audit gates.
```

## 14. CI requirements

Add GitHub Actions workflow:

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run smoke:dispatch
      - run: npm run audit
      - run: npm run audit:private
```

CI must not require private files, Redis, Spectre, or real dispatch targets.

## 15. Testing plan

Minimum tests for this pass:

### 15.1 Import tests

Add script-level tests or smoke fixtures that verify:

- valid example profile dry-run passes
- valid example profile import against temp DB passes
- malformed JSON fails
- unknown task fields fail
- invalid task status fails
- invalid priority fails
- invalid agent status fails
- secret-looking profile value fails
- env var references are accepted
- duplicate task handling is deterministic

### 15.2 Export tests

Verify:

- export works against temp DB with seeded data
- task titles/descriptions are redacted
- dispatch targets/config are redacted
- output passes private audit
- JSON parses

### 15.3 Audit tests

Verify:

- clean repo passes
- temp fixture with fake secret value fails
- docs mentioning `token` without assigning a secret do not fail
- tracked blocked path detection works using injectable fixture list or test mode

### 15.4 Existing gates

Must still pass:

```bash
npm test
npm run smoke:dispatch
npm run audit
npm run audit:private
```

## 16. Security requirements

- Do not store secrets in SQLite as part of import unless explicitly accepted and documented; prefer env var references.
- Do not print secrets in validation errors.
- Do not send imported profile data anywhere.
- Do not add telemetry.
- Do not add network calls to audit/import/export scripts except existing local DB usage.
- Do not commit local/private examples.
- Do not add Jeremy-specific data to fixtures.
- Do not weaken existing webhook validation.
- Do not make dispatch automatically enabled for imported agents unless the profile explicitly opts in.

## 17. Implementation approach

Recommended order:

1. Add `.gitignore` private boundaries.
2. Add example fixture with generic fake data.
3. Extract or duplicate minimal validation helpers for CLI scripts.
4. Implement `scripts/audit-private-data.js` first so guardrails exist before import/export.
5. Implement `scripts/import-local-profile.js` with `--dry-run` and temp DB test path.
6. Implement `scripts/export-redacted.js`.
7. Replace or sanitize default seed data.
8. Add docs and README/CONTRIBUTING links.
9. Add CI workflow.
10. Run gates and update CHANGELOG.

## 18. Acceptance criteria

This pass is done when:

- `local/` and `baton-private/` are ignored.
- A generic example local profile is tracked.
- A private profile can be imported into a local BATON DB.
- Import validates shape and rejects obvious secrets.
- A redacted export can be generated from local state.
- Redacted export does not contain task titles/descriptions/dispatch secrets.
- `npm run audit:private` passes on the public repo.
- CI runs `npm test`, `npm run smoke:dispatch`, `npm run audit`, and `npm run audit:private`.
- README/CONTRIBUTING/private-use docs explain the public/private split.
- Existing tests and smoke scripts still pass.
- CHANGELOG has an Unreleased entry.

## 19. Suggested first private usage after merge

After this pass lands, Jeremy can create an ignored local profile like:

```text
local/profile.json
```

Then run:

```bash
npm run audit:private
npm run import:local -- local/profile.json --dry-run
npm run import:local -- local/profile.json
npm start
```

Open:

```text
http://127.0.0.1:4200/#/flow
```

Then use BATON with real tasks locally while keeping the public repo clean.

## 20. Build-agent handoff notes

The build agent should keep this as one cohesive pass, but cut scope if necessary in this order:

1. Must-have: `.gitignore`, audit script, docs, generic fixture, CI.
2. Should-have: import local profile with dry-run and secret rejection.
3. Should-have: redacted export.
4. Nice-to-have: full test matrix for all validation edge cases.
5. Nice-to-have: seed data gating instead of only sanitization.

If time is tight, do not skip the audit script. The point of this pass is safety before real private usage.
