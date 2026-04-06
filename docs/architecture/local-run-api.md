
# Local Run API

The Run API is the local HTTP wrapper above `packages/agent-kernel`.

## Purpose

The runtime gateway only handles model execution. The Run API handles bounded run lifecycle operations:

- create a run from an intent
- inspect run state
- inspect events and artifacts
- approve or reject a validated proposal
- apply an approved patch
- complete an applied run

The current HTTP surface is:

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

## Canonical path

shell → run-api → agent-kernel → runtime-gateway → oMLX

## Core guarantees

- run lifecycle is exposed through one operator-facing API
- approval, apply, and complete remain separate actions
- the shell does not bypass the bounded kernel

Boundaries:

- This is a local, single-host API. There is no background queue, worker pool, or distributed coordinator.
- Run state is file-backed under `storage/runs/`, and per-run worktrees live under `workspace/run-<runId>/`.
- The API exposes lifecycle steps; it does not claim production orchestration semantics on its own.
