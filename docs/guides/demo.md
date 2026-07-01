# Demo Mode

Demo mode seeds a realistic local workload for a fictional AI-native commerce company, Demo Co. It creates demo agents, tasks, runs, review packets, and generated Flow touches so a fresh clone shows a populated ranked queue immediately.

Run:

```bash
npm run demo
npm start
```

Open:

```text
http://127.0.0.1:4200/#/flow
```

The seeded queue includes review work, idle-agent assignment candidates, stale work, inbox triage, blockers, failed runs, and refinement work from an invalid review packet.

Demo rows use a `demo-` ID prefix. Running `npm run demo` again refreshes the demo dataset without duplicating rows.

To remove only demo data:

```bash
npm run demo:clean
```

`demo:clean` deletes only rows tied to `demo-` IDs and leaves user data alone.
