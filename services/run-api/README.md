
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
- `AGENT_STACK_RUN_API_MAX_BODY_BYTES` – maximum JSON request size in bytes, defaults to `1048576`
- `AGENT_STACK_RUN_API_BEARER` – optional inbound bearer token for local operator access
- `GSD_RUNTIME_GATEWAY_URL` – runtime gateway URL used by model intents
- `GSD_RUNTIME_GATEWAY_BEARER` – optional bearer token for the runtime gateway
- `AGENT_STACK_ACTOR` – actor recorded for approvals and run ownership

## Error behavior

- `400` for structured request and intent validation errors such as `missing_intent`, `invalid_json`, and `invalid_intent`
- `413` for oversized request bodies with the structured error code `request_too_large`
- `404` for missing runs
- `409` for illegal lifecycle transitions or patch precondition drift during apply
- `500` for persistence corruption or unexpected internal failures

## Logging

Requests and failures emit one structured JSON log line on stdout. Each record includes a request id, method, path, status, duration, and the run id when one is known.

If `AGENT_STACK_RUN_API_BEARER` is not configured, this API is only safe for strictly local or otherwise trusted access.

## Supported local workflow

```bash
./scripts/start-stack.sh
./scripts/check-run-api.sh
```

Use `./scripts/start-run-api.sh` only when the rest of the stack is already running and you want to restart run-api alone.
