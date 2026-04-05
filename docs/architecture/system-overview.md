# System Overview

## Core separation

- GSD is the operator shell and orchestration surface.
- oMLX is the dedicated model runtime.
- the runtime gateway is the seam between them.
- TurboQuant stays experimental until benchmarked on real workloads.

## Default execution path

```text
User Intent
  -> GSD shell / agent session
  -> tool registry / policy gate
  -> runtime gateway
  -> oMLX runtime
  -> streamed response
  -> GSD verification / next step
```

## Why this shape

This avoids a fake monolithic merge. GSD keeps workflow and session logic. oMLX keeps inference, caching, batching, model loading, and memory enforcement. The gateway gives you an explicit place to enforce model allowlists, health checks, and compatibility fixes.
