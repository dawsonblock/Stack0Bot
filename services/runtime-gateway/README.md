# Runtime Gateway

This FastAPI service sits between the shell/control plane and a local upstream model runtime.

## Purpose

- keep the bounded control plane and the upstream model runtime decoupled at a process boundary
- enforce optional bearer auth plus model allowlists, aliases, fallbacks, and token caps
- expose shell-friendly runtime metadata
- proxy the currently implemented chat and messages APIs to the upstream runtime

The live scripts currently point this service at oMLX, but that upstream process is outside the supported product surface.

## Endpoints

- `GET /healthz` — lightweight upstream probe
- `GET /v1/capabilities` — static capability flags for routing and shell visibility
- `GET /v1/runtime/policy` — current model and timeout policy documents
- `GET /v1/models` — pass-through model list from oMLX
- `GET /v1/runtime/status` — merged shell-friendly status document
- `POST /v1/chat/completions`
- `POST /v1/messages`

`/v1/completions`, `/v1/embeddings`, and `/v1/rerank` are not implemented in the current code and are not part of the supported local path.

## Shell integration

The v2 combined stack includes a GSD-side `/gsd runtime` command family that reads from:

- `GSD_RUNTIME_GATEWAY_URL`
- `GSD_RUNTIME_GATEWAY_BEARER`

That lets the shell show:

- gateway health
- upstream oMLX reachability
- capability flags
- model visibility

## Run locally

```bash
./scripts/setup-runtime-gateway.sh
GSD_RUNTIME_GATEWAY_BEARER=your-token ./scripts/start-stack.sh
```

To start only the gateway after setup, run:

```bash
cd services/runtime-gateway
source .venv/bin/activate
uvicorn app:app --host 127.0.0.1 --port 8787
```
