# V3 Quickstart

The supported V3 local workflow now runs from the repository root.

## Offline verification

```bash
npm run verify
npm run test:coverage
```

`npm run test:coverage` reports only on the Node/TS core path. It does not cover Python files in `services/runtime-gateway`.

## Start the runtime

```bash
export OMLX_MODEL_DIR="$HOME/models"
./scripts/setup-local-stack.sh
./scripts/start-stack.sh
```

## Smoke checks

```bash
./scripts/check-stack.sh
npm run smoke
```

If the stack is already running, `npm run verify:live` runs the offline verification sweep and then the live smoke path in one command.

## Bounded shell calls

```bash
node apps/shell/bin/agent-stack-shell.mjs status
node apps/shell/bin/agent-stack-run.mjs prompt "Explain the current runtime policies"
```
