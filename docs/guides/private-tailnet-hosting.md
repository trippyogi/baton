# Private tailnet hosting

BATON defaults to local-only development:

```bash
npm start
# http://127.0.0.1:4200
```

For faster iteration across your own devices, you can host BATON on one machine and access it over a private network such as Tailscale. The recommended pattern is to bind BATON to one specific private interface, not every interface.

## Configuration

Use environment variables:

```bash
BATON_HOST=100.x.y.z
VMC_PORT=4200
BATON_PUBLIC_BASE_URL=http://100.x.y.z:4200
```

Notes:

- `BATON_HOST` controls the interface Express listens on.
- `VMC_PORT` controls the port.
- `BATON_PUBLIC_BASE_URL` is used by dispatch/callback flows when agents need a reachable base URL.
- Keep ordinary local development on the default `127.0.0.1`.
- Do **not** bind to `0.0.0.0` unless you have added appropriate network restrictions and write-auth controls.

## Example systemd user service

Create a private environment file outside the repository:

```ini
# ~/.config/baton-dev.env
BATON_HOST=100.x.y.z
VMC_PORT=4200
BATON_PUBLIC_BASE_URL=http://100.x.y.z:4200
NODE_ENV=development
PATH=/path/to/node/bin:/usr/local/bin:/usr/bin:/bin
```

Then create a user service:

```ini
# ~/.config/systemd/user/baton-dev.service
[Unit]
Description=BATON private tailnet dev server
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/path/to/baton
EnvironmentFile=%h/.config/baton-dev.env
ExecStart=/path/to/npm start
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
```

Enable and start:

```bash
systemctl --user daemon-reload
systemctl --user enable --now baton-dev.service
systemctl --user status baton-dev.service --no-pager
```

Open BATON from another device on the same tailnet:

```text
http://100.x.y.z:4200/#/flow
```

## Security posture

Private tailnet hosting is meant for personal/dev use.

Recommended guardrails:

- bind to a specific private IP, not `0.0.0.0`
- keep `.env`, local DBs, and service env files out of Git
- use `npm run audit:private` before commits
- add API write auth before exposing BATON to untrusted networks or autonomous agents
- prefer redacted exports for bug reports

## Troubleshooting

Check bind/listen state:

```bash
ss -ltnp | grep ':4200'
```

Check health:

```bash
curl http://100.x.y.z:4200/api/health
```

View logs:

```bash
journalctl --user -u baton-dev.service -f -o cat
```
