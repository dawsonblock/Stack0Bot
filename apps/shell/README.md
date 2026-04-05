
# Shell App Notes

The preferred shell remains the vendored GSD repo or an installed `gsd-pi` binary configured through `~/.gsd/agent/models.json`.

V5 adds a real local operator surface above the bounded kernel:

- runtime inspection through `agent-stack-shell`
- run lifecycle control through `agent-stack-run`
- a local Run API in `services/run-api`

## Companion CLIs

Runtime and policy inspection:

```bash
node apps/shell/bin/agent-stack-shell.mjs status
node apps/shell/bin/agent-stack-shell.mjs capabilities
node apps/shell/bin/agent-stack-shell.mjs models
node apps/shell/bin/agent-stack-shell.mjs run-api
node apps/shell/bin/agent-stack-shell.mjs runs
```

Bounded run lifecycle:

```bash
node apps/shell/bin/agent-stack-run.mjs prompt "summarize available models"
node apps/shell/bin/agent-stack-run.mjs list
node apps/shell/bin/agent-stack-run.mjs get <runId>
node apps/shell/bin/agent-stack-run.mjs events <runId>
node apps/shell/bin/agent-stack-run.mjs approve <runId> "looks good"
node apps/shell/bin/agent-stack-run.mjs apply <runId>
node apps/shell/bin/agent-stack-run.mjs complete <runId> "done"
```

## Scope

This is still a source-level integration stack. The shell is an operator surface only. The canonical execution path is:

shell → run-api → agent-kernel → runtime-gateway → oMLX
