# Repo Map

## Operational core path

- `apps/shell` – thin operator surface for status checks and run lifecycle commands.
- `services/run-api` – local HTTP entrypoint for run creation, inspection, approval, apply, and completion.
- `packages/agent-kernel` – bounded control core with state machine, artifacts, promotion, and replay.
- `services/runtime-gateway` – policy boundary in front of oMLX.
- `vendor/omlx-main` – local runtime dependency served as a separate process.

## Source integrations kept out of the core build path

- `vendor/gsd-2-main` – vendored shell and workflow source kept for reference and integration work, not as the kernel.
- `configs/*`, `patches/*`, and `examples/*` – supporting configuration, samples, and patch material.

## Experimental

- `vendor/Turbo-master` – research-grade KV-cache compression path.

## Reference only

- `apps/desktop` – placeholder documentation only; not an implemented client.
- `references/open-multi-agent-main` – small educational multi-agent framework.
- `references/open-claude-cowork-master` – desktop wrapper reference.
- `references/openclaw-composio-plugin-master` – Composio plugin example.
- `references/awesome-mcp-servers-3-main` – MCP discovery and curation reference.

## Build boundary

The root workspace and tests cover only `apps/shell`, `packages/agent-kernel`, `services/run-api`, and `services/sandbox`. Vendor and reference trees are intentionally outside the root build, lint, and test path.
