# System Overview

## Supported runtime path

```text
operator shell
  -> run-api
  -> agent-kernel
  -> runtime-gateway
```

## Responsibilities

- `apps/shell` is a thin operator surface.
- `services/run-api` is a narrow HTTP wrapper over run lifecycle operations.
- `packages/agent-kernel` is the single execution authority for validation, approval, apply, completion, events, and artifacts.
- `services/runtime-gateway` is the policy boundary for local model traffic.

## Out of surface

Local live verification can point `services/runtime-gateway` at a separate upstream model runtime such as oMLX, but that upstream process is not part of the supported product surface. Vendored and reference trees are not part of the runtime path unless the core code imports them and the core tests prove them.
