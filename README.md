# Baton Core

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

## Getting started

From the parent `vector-mission-control` repo:

```bash
npm install
cp .env.example .env
npm start
```

The parent app loads `baton-core` plus optional internal extensions.

## Extending Baton

Create `baton-internal/extension.js` alongside `baton-core`:

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

MIT, unless overridden by the parent repo.
