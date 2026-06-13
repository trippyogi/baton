# Security Policy

BATON is an open-source project for operating human-in-the-loop agent workflows. Because it can connect to queues, GitHub webhooks, local databases, and private extensions, security reports are taken seriously.

## Supported versions

BATON is currently pre-1.0. Security fixes are applied to the `main` branch until the first stable release line exists.

| Version | Supported |
| --- | --- |
| `main` / `0.x` | Yes |
| older snapshots | No |

## Reporting a vulnerability

Please do **not** open a public GitHub issue for suspected vulnerabilities.

Preferred reporting path:

1. Use GitHub private vulnerability reporting if it is enabled on the repository.
2. If private reporting is unavailable, contact the maintainer directly and include enough detail to reproduce the issue.

Include:

- affected commit or version
- impact summary
- reproduction steps or proof of concept
- whether secrets, local data, queues, webhooks, or external systems are involved
- suggested mitigation if known

## Security expectations

BATON should follow these defaults:

- never commit `.env`, local SQLite DB files, logs, tokens, or private extension code
- treat Redis/worker dispatch as optional unless explicitly configured
- avoid marking agent work as running unless a real run/dispatch exists
- validate webhook signatures before doing work
- escape user-controlled UI output
- reject unsafe touch actions by type
- keep dependency audit clean before release tags

## Maintainer checklist before releases

Run:

```bash
npm test
npm run audit
```

Also verify:

- `.env` is not tracked
- local `data/*.db*` files are not tracked
- no secrets appear in diffs
- README, CHANGELOG, and package version agree
