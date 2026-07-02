# Fork Quickstart

This guide is for someone who finds BATON on GitHub, forks it, and wants a working local copy before adapting it to their own agents.

## What works out of the box

A fresh clone can run without API keys, Redis, webhooks, or external services:

- local Express server
- local SQLite database under `data/`
- browser UI at `/#/flow`
- demo workload seeded by `npm run demo`
- self-contained tests that use temporary databases

## 1. Clone and install

```bash
git clone <your-fork-or-upstream-url> baton
cd baton
nvm use
npm install
npm run doctor
```

BATON recommends Node 20 because `better-sqlite3` is the only native dependency and Node 20 gives the most predictable install path. Node 20+ is supported, but Node 20 is the safest baseline for new forks.

If `npm run doctor` passes, your clone has the expected runtime, docs, writable local folders, and native SQLite support.

## 2. Seed a realistic demo

```bash
npm run demo
npm start
```

Open:

```text
http://127.0.0.1:4200/#/flow
```

You should see a populated Flow queue with review work, idle-agent assignment candidates, stale runs, failed runs, inbox triage, and an evaluator/refinement example.

Reset only demo rows any time:

```bash
npm run demo:clean
npm run demo
```

Demo rows use a `demo-` ID prefix so cleanup does not delete your own local tasks.

## 3. Run the verification gate

```bash
npm test
npm run smoke:dispatch
npm run audit
npm run audit:private
```

What these cover:

- `npm test`: syntax checks, Flow smoke test, and adversarial loop-integrity checks
- `npm run smoke:dispatch`: full dispatch → ACK → review-packet → completion loop against a local fake webhook agent
- `npm run audit`: production dependency audit
- `npm run audit:private`: verifies private local data and obvious secrets are not tracked

## 4. Understand the local files

BATON keeps operational state local by default:

| Path | Purpose | Tracked? |
|---|---|---|
| `data/*.db` | SQLite app state | no |
| `.env` | local config/secrets | no |
| `local/` | private operator files and bridge inboxes | no |
| `baton-private/` | private extensions | no |
| `exports/redacted-*` | redacted bug reports | no |

Do not commit real customer, company, task, agent, or token data. Use the redacted export tooling if you need to share an issue reproduction.

## 5. Add your first real agent

You have two starter paths:

### A. Webhook agent

Use the fake webhook harness first:

```bash
npm run fake:agent
npm run smoke:dispatch
```

The historical compatibility script is `npm run fake:spectre`; `npm run fake:agent` is the fork-friendly alias.

Then implement a receiver for `POST /baton/dispatch` and configure an agent with:

- a webhook URL env var
- a bearer token env var
- `dispatch_enabled: true`
- `dispatch_config.transport: "webhook"`

BATON sends a `baton.dispatch.v1` envelope and expects an ACK, then status/review callbacks.

### B. Local inbox bridge

If your agent is not a network service yet, use a local inbox bridge:

```bash
npm run check:local-bridge
npm run bridge:local
```

The compatibility script is `npm run bridge:nectar`; the fork-friendly alias is `npm run bridge:local`.

The bridge writes accepted dispatch envelopes into an ignored local inbox directory so a human or local agent process can pick them up safely.

## 6. Hosting for personal testing

The safest default is localhost:

```bash
npm start
```

If you bind BATON outside localhost, API routes require `BATON_API_TOKEN`:

```bash
BATON_HOST=0.0.0.0 BATON_API_TOKEN=change-me npm start
```

This is intentional. The browser UI may load without a token, but API calls will fail unless your client sends the bearer token or you place BATON behind an authenticated private proxy.

See `docs/guides/private-tailnet-hosting.md` for private network hosting notes.

## Common fixes

### `npm install` fails on Node version

Run:

```bash
nvm install 20
nvm use
npm install
```

### UI loads but Flow is empty

Run:

```bash
npm run demo
```

Then refresh `http://127.0.0.1:4200/#/flow`.

### UI loads but API returns 503 on LAN/tailnet

You bound BATON outside localhost without `BATON_API_TOKEN`. Either return to localhost, set a token and use an authenticated client/proxy, or keep BATON local behind a trusted tunnel/proxy.

### Redis errors

Redis is optional for local Flow use. Queue-related screens degrade when Redis is missing; the Flow queue and demo path do not require Redis.
