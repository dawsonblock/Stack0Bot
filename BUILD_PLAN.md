# Build Contract

The combined stack is a bounded local agent system.

Canonical execution path:

1. Shell submits an intent.
2. Agent kernel validates the intent.
3. Execution authority executes read-only intents or proposes patch artifacts for mutating intents.
4. Promotion gate validates patch artifacts.
5. Run pauses in `awaiting_approval`.
6. Explicit approval applies the patch artifact.
7. Finalize writes the run summary.

Build and proof commands that currently define this contract:

- `npm run build`
- `npm run lint`
- `npm test`
- `npm run test:coverage`
- `npm run verify`
- `npm run verify:live`
- `npm run smoke`

`npm run test:coverage` covers the Node/TS core path only. It does not claim coverage for Python files in `services/runtime-gateway`.

`npm run verify:live` requires a running local stack because it includes the smoke step.

Patch apply targets `workspace/run-<runId>/`, not the repository root.

Non-goals for the core path:
- distributed orchestration
- remote daemon dependency
- implicit direct runtime calls from the shell
- default TurboQuant enablement
