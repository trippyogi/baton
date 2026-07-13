# Agent folder bridge

BATON should be the central attention ledger, not another agent runtime.

The simplest broad-agent bridge is a private local folder contract. BATON writes
task handoffs to one shared inbox folder. Agent harnesses poll that folder on
their own cron, work on files assigned to their `agent_id`, and write result JSON
back to one shared outbox folder. BATON then syncs those results into runs,
review packets, and Flow.

## Critique of heavier setup

Avoid these as MVP requirements:

- Redis or pub/sub: useful later for distributed workers, retries, and
  backpressure, but unnecessary for one local operator machine.
- WebSockets: useful for live UI polish, but not needed for durable handoff.
- MCP: useful later for tool discovery, but not needed for dispatch.
- Webhook servers per agent: good for mature integrations, but too much setup
  for broad local agent support.
- Per-agent folders: useful later, but `agent_id` inside JSON is enough for v1.
- Auto-routing: tempting, but human-directed routing is safer until the run
  ledger is trustworthy.

Use files first because they are easy to inspect, easy to back up, cron-native,
and compatible with almost every agent harness.

## Folder layout

Default root:

```text
local/agent-bridge/
  inbox/
  outbox/
```

Override the root with:

```bash
BATON_AGENT_DIR=/path/to/private/agent-bridge
```

## Setup

```bash
npm run agent:setup
```

Cron-friendly sync:

```bash
* * * * * cd /path/to/baton && npm run agent:sync
```

Agent harnesses can use their own cron or scheduler. BATON only requires that
they read inbox files and write outbox result files.

## Configure an agent

Create or import an agent with folder dispatch:

```json
{
  "id": "nectar",
  "name": "Nectar",
  "type": "openclaw",
  "status": "idle",
  "skills": ["planning", "coding", "memory"],
  "dispatch_enabled": true,
  "dispatch_transport": "folder",
  "dispatch_config": {
    "transport": "folder"
  }
}
```

When BATON passes work to this agent it writes:

```text
local/agent-bridge/inbox/run_<run_id>.json
```

## Inbox task schema

```json
{
  "schema": "baton.agent_task.v1",
  "status": "queued",
  "queued_at": "2026-07-13T17:00:00.000Z",
  "agent_id": "nectar",
  "run_id": "run_123",
  "touch_id": "touch_abc",
  "task_id": "task_xyz",
  "title": "Improve public landing page",
  "objective": "Tighten the landing page narrative for a job-search positioning project.",
  "instructions": ["Return a concise result."],
  "envelope": {
    "schema": "baton.dispatch.v1"
  }
}
```

The agent should process files where `agent_id` matches its identity.

## Outbox result schema

Write one result file under:

```text
local/agent-bridge/outbox/run_<run_id>.json
```

Example:

```json
{
  "schema": "baton.agent_result.v1",
  "run_id": "run_123",
  "status": "review_ready",
  "summary": "Completed a first pass and need human review.",
  "next_action": "Review the proposed changes.",
  "artifacts": []
}
```

Supported statuses:

- `running`
- `blocked`
- `review_ready`
- `completed`
- `failed`

Run:

```bash
npm run agent:sync
```

Processed result files are renamed with a `.synced` suffix. Invalid result files
are renamed with a `.failed` suffix and get an `.error.txt` file.

## Oversight model

BATON should surface the most important human touches across agents:

- queued high-impact inbox work
- blocked runs needing a decision
- review-ready results
- failed runs that are cheap to retry
- idle capable agents that can take ready work

The goal is not to hide each agent platform. The goal is to make BATON the one
place where the operator can see what deserves attention next.
