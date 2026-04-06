# Promotion Flow

Mutating runs follow one deterministic pass through the bounded runtime:

1. `edit_files` executes and writes a patch artifact.
2. The controller transitions to `proposed` and then `awaiting_approval`.
3. The promotion gate stages a validation worktree and runs the current validator set: test, lint, diff, and lightweight security screening.
4. Validator reports and a review-bundle artifact are written for inspection.
5. If validation succeeds, the controller transitions to `validated` and waits for an explicit approve or reject call.
6. Approval is recorded before apply.
7. `applyPatchArtifact()` rechecks approved context and patch preconditions, then writes files into `workspace/run-<runId>/`.
8. Completion writes the summary artifact.

Notes:

- There is no recursive replanning loop in this flow.
- If no executable validation path exists, the run fails closed unless the request records an explicit override.
- Proposal generation is not the side-effect boundary. The actual file mutation boundary is the explicit apply step.
