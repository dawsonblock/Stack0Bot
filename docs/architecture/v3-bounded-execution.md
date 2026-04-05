# V3 Bounded Execution Spine

This stack enforces a single execution authority for intent handling and a single explicit apply path for filesystem mutation.

## Core rules

- The shell talks to the system through `services/run-api` only.
- `execution-authority.ts` may read files, search code, run bounded commands, call the runtime gateway, or propose a patch artifact.
- Actual file mutation happens only in `apply-artifact.ts`, and only after explicit approval.
- Command execution is delegated to `services/sandbox`, which acts as a restricted subprocess runner with cwd scoping, command allowlists, timeout/output bounds, and honest degraded network reporting rather than a host-isolated sandbox.
- `run_command` is not part of the supported runtime path; the live system rejects it rather than treating it as an operator feature.
- Model calls are delegated to `services/runtime-gateway`.
- Every action emits an event into `storage/runs/<runId>/events.jsonl`
- Every mutating action produces an artifact under `storage/runs/<runId>/artifacts/`
- Every proposed patch also produces a `review-bundle` artifact that captures the patch reference, validator results, override state, and apply preconditions.
- Promotion stages the proposed post-patch worktree and runs executable validators before a run can become `validated`
- Mutating runs fail closed when no executable validation path exists, unless an explicit override is recorded
- The `security-validator` is lightweight pattern screening, not a hardened security policy engine.
- Apply writes into `workspace/run-<runId>/`, not into the repository root
- Finalization writes summary artifacts only and does not mutate code

## Flow

1. Shell submits a bounded intent.
2. Runtime controller validates the intent.
3. State machine moves from `created` to `executing`.
4. Execution authority performs exactly one bounded action or proposes a patch artifact.
5. Promotion gate stages the patch into a temporary validation workspace and evaluates it.
6. The run pauses in `awaiting_approval` or `validated` until an explicit approval decision is recorded.
7. `apply-artifact.ts` writes the approved patch into the per-run worktree.
8. Completion writes the summary artifact and leaves code unchanged.
