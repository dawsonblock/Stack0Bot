
# Local Run API

This service exposes a bounded local HTTP API over `packages/agent-kernel`.

It is the operator-facing surface for creating runs, inspecting state, viewing events,
approving or rejecting proposed patches, applying approved artifacts, and completing runs.

Mutating runs validate against a staged post-patch worktree, fail closed when no executable validation path exists, and apply only into `workspace/run-<runId>/` after approval.

## Core routes

- `GET /healthz`
- `GET /v1/runs`
- `POST /v1/runs`
- `GET /v1/runs/:runId`
- `GET /v1/runs/:runId/events`
- `GET /v1/runs/:runId/artifacts`
- `POST /v1/runs/:runId/approve`
- `POST /v1/runs/:runId/reject`
- `POST /v1/runs/:runId/apply`
- `POST /v1/runs/:runId/complete`

## Environment

- `AGENT_STACK_BASE_DIR` – stack root, defaults to current working directory
- `AGENT_STACK_RUN_API_PORT` – defaults to `8788`
- `GSD_RUNTIME_GATEWAY_URL` – runtime gateway URL used by model intents
- `GSD_RUNTIME_GATEWAY_BEARER` – optional bearer token for the runtime gateway
- `AGENT_STACK_ACTOR` – actor recorded for approvals and run ownership

## Error behavior

- `400` for invalid request bodies or invalid intents
- `404` for missing runs
- `409` for illegal lifecycle transitions or patch precondition drift during apply

## Supported local workflow

```bash
./scripts/start-stack.sh
./scripts/check-run-api.sh
```

Use `./scripts/start-run-api.sh` only when the rest of the stack is already running and you want to restart run-api alone.
