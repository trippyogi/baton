# Baton

Reusable core for a two-agent operations dashboard: plan, queue, execute, inspect, and keep a human in the loop.

## Pattern

```
Orchestrator -> Queue -> Executor -> Dashboard
      ^                                |
      |----------- Human --------------|
```

## Features

- Task management and queue visualization
- Agent run history, logs, fix attempts, output previews, token/cost tracking, and build log viewer
- Shared Requests handoff queue for Jeremy ↔ Marko async requests
- Creatives screen backed by the configured creative log
- Costs, performance, memory, team, workshop, alerts, and GitHub webhook routes
- Memory/context management
- Extension system for private business logic

## Install

Requires Node.js 20 or newer. Install from npm:

```bash
npm install @trippyogi/baton
cd node_modules/@trippyogi/baton
cp .env.example .env
npm start
```

For development from a source checkout:

```bash
git clone https://github.com/trippyogi/baton.git
cd baton
npm install
cp .env.example .env
npm start
```

Baton listens on `127.0.0.1:4200` by default. Set `HOST` and `PORT` to change
the bind address. Redis-backed queue and webhook features use `REDIS_URL`.

## Extending Baton

Create `baton-internal/extension.js` alongside Baton:

```js
module.exports = {
  register(app, db) {
    app.get('/api/my-route', (req, res) => {
      res.json({ ok: true })
    })
  }
}
```

Baton detects and loads the extension at startup. It falls back gracefully when absent.

## License

[MIT](LICENSE)
