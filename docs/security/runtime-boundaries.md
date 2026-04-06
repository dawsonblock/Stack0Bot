# Runtime Boundaries

- The supported local path is `apps/shell` -> `services/run-api` -> `packages/agent-kernel` -> `services/runtime-gateway`.
- The kernel persists run records, event logs, and artifacts under `storage/runs/` and writes proposed or applied files only under `workspace/run-<runId>/`.
- `edit_files` creates a patch artifact; only the explicit apply step writes files.
- The apply boundary requires explicit approved context and still rechecks patch preconditions before mutating the worktree.
- `services/sandbox` is a bounded subprocess runner with command allowlists, cwd scoping, and timeout limits. It does not claim VM, container, or host-enforced network isolation.
- `services/runtime-gateway` is a local HTTP policy layer for bearer auth and model selection rules. It is not a general orchestration system by itself.
