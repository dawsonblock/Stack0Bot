
# Run API quickstart

The supported local run-api path starts from the repo root and assumes the stack was prepared with `./scripts/setup-local-stack.sh`.

## Start and verify

```bash
npm run verify
./scripts/start-stack.sh
./scripts/check-run-api.sh
```

`npm run verify` is the offline repo-root verification sweep. `npm run verify:live` is available after the stack is running and includes the live smoke path.

`./scripts/start-stack.sh` already starts `services/run-api`, so `./scripts/start-run-api.sh` is only needed when oMLX and runtime-gateway are already running and you want to restart run-api by itself.

## Read-only run

```bash
node apps/shell/bin/agent-stack-run.mjs prompt "list available local runtime capabilities"
```

Read-only runs complete immediately and record model-call artifacts and events.

## Inspecting a run

```bash
node apps/shell/bin/agent-stack-run.mjs list
node apps/shell/bin/agent-stack-run.mjs get <runId>
node apps/shell/bin/agent-stack-run.mjs events <runId>
node apps/shell/bin/agent-stack-run.mjs artifacts <runId>
```

The snapshot includes the per-run worktree path under `workspace/run-<runId>/`.

## Mutating run lifecycle

1. Create a mutating run with `start-json` or `start-file`.
2. Inspect the `review-bundle` artifact, validator-report artifacts, and `validator_executed` events.
3. Approve or reject explicitly.
4. Apply the approved patch artifact into the per-run worktree.
5. Complete the run to write the summary artifact.

Mutating runs fail closed if no executable validation path exists, unless the request records an explicit `validationOverride`.

For coverage reporting on the Node/TS side of this path, run `npm run test:coverage`. That report excludes the Python runtime-gateway files.
