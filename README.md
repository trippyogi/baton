# baton

The ops layer for two-agent AI systems. Pass the baton.

## What is Baton?

A lightweight mission control dashboard for running a two-agent AI system — one orchestrator that plans, one executor that builds, a job queue between them, and a human in the loop.

Built for indie operators running AI-augmented businesses. Not an observability tool — an operations layer.

## The Pattern

```
Orchestrator → Queue → Executor → Dashboard
      ↑                                ↓
      └──────────── Human ─────────────┘
```

## Features

- Task management and job queue visualization
- Agent run history and cost tracking
- Build log viewer
- Memory and context management
- Team overview
- Extension system for private business logic

## Getting Started

```bash
git clone https://github.com/trippyogi/baton
cd baton
npm install
cp .env.example .env
node server/index.js
```

## Extending Baton

Create `baton-internal/extension.js` alongside your baton directory:

```js
module.exports = {
  register(app, db) {
    // Add your private routes and logic here
    app.get('/api/my-route', (req, res) => { ... });
  }
};
```

Baton detects and loads it at startup. Falls back gracefully if absent.

## License

MIT
