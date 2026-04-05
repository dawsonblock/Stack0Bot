# Quickstart

The supported local workflow now runs from the repository root.

## Prerequisites

- Node.js and npm
- Python 3
- A local oMLX model directory exposed through `OMLX_MODEL_DIR`

## Setup and start

```bash
export OMLX_MODEL_DIR="$HOME/models"
./scripts/setup-local-stack.sh
./scripts/start-stack.sh
```

`./scripts/start-stack.sh` starts all three operational services:

- oMLX on `:8000`
- runtime-gateway on `:8787`
- run-api on `:8788`

## Readiness and smoke

```bash
npm run verify
./scripts/check-stack.sh
npm run smoke
```

`npm run verify` runs the offline build, lint, and test sweep from the repo root.

`npm run smoke` drives the canonical operator path through the shell CLI, creates a read-only run, proposes a mutating run, validates it with real commands, records approval, applies the patch into a per-run worktree, completes the run, and verifies the resulting artifacts.

If the stack is already running and you want one command that includes the live smoke step, use `npm run verify:live`.

`npm run test:coverage` writes Node/TS core-path coverage reports to `coverage/`. It does not measure the Python runtime-gateway files.

## Operator commands

```bash
node apps/shell/bin/agent-stack-shell.mjs status
node apps/shell/bin/agent-stack-run.mjs list
```

`apps/desktop` is not part of this quickstart because it is not an implemented client.
