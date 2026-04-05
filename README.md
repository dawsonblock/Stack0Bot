# Agent Stack Best

This repository is a bounded local agent stack. The supported product surface is:

`apps/shell` → `services/run-api` → `packages/agent-kernel` → `services/runtime-gateway`

The supported shell is the thin operator surface in `apps/shell`. Live verification can point `services/runtime-gateway` at a local upstream model runtime such as oMLX, but that upstream process is outside the supported product surface.

## What is operational

- Root workspace packaging and builds for the core Node surface only.
- Explicit run lifecycle with proposal, validation, approval, apply, and completion.
- Artifact-first mutation flow with JSONL events and replayable run state.
- Review-bundle artifacts for every proposed patch, including patch references, validator results, override flags, and apply preconditions.
- Executable promotion validators that run bounded test and lint commands on staged post-patch worktrees, plus diff checks and lightweight safety screening.
- A runtime gateway that enforces bearer auth, model allowlists, aliases, fallbacks, and token caps.
- Root setup, start, check, lint, test, and smoke commands.
- Root verification and Node/TS coverage commands.

## What is not operational

- `apps/desktop` is not an implemented client.
- `vendor/omlx-main` is a local upstream runtime helper used by setup and live-run scripts, not part of the supported product surface.
- `vendor/Turbo-master` is experimental and not enabled by default.
- `vendor/gsd-2-main` is vendored source kept for reference and integration work, not the supported shell or kernel.
- `references/*` are reference material only.
- No distributed orchestration, no shell-side writes, and no implicit patch apply during proposal.

## Local setup

1. Set `OMLX_MODEL_DIR` to a local directory that already contains the models you want oMLX to serve.
2. Run `./scripts/setup-local-stack.sh` from the repo root.
3. Start the local stack with `./scripts/start-stack.sh`.
4. Verify readiness with `./scripts/check-stack.sh`.
5. Run `npm run verify` for the offline build, lint, and test sweep.
6. Run the reproducible canonical-path smoke test with `npm run smoke`.

## Root commands

- `npm run build` builds the core Node workspace.
- `npm run lint` checks the build graph, shell entrypoints, and runtime-gateway syntax.
- `npm test` runs the focused bounded-lifecycle, sandbox, run-api, CLI, and runtime-gateway tests.
- `npm run test:coverage` emits coverage for the Node/TS core path only. It does not cover Python files under `services/runtime-gateway`.
- `npm run verify` runs `build`, `lint`, and `test` as one offline verification step.
- `npm run verify:live` runs `verify` and then `smoke`. It requires a running local stack.
- `npm run smoke` runs the shell-driven lifecycle smoke test against a locally running stack.

## Boundaries that remain enforced

- Mutating runs produce patch artifacts before any apply step.
- Mutating runs also produce a review-bundle artifact before approval so validator output, patch references, override state, and apply preconditions are inspectable together.
- Validation fails closed when no executable validation path exists, unless an explicit override is recorded.
- Approval remains explicit and recorded before apply.
- Patch apply writes into `workspace/run-<runId>/`, not into the repository root.
- `run_command` remains a bounded read-only intent with a fixed executable allowlist; the shell CLI does not expose it as a first-class operator command.
- Finalization writes summary artifacts only and does not mutate code.
