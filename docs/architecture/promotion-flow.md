# Promotion Flow

Mutating runs follow this lifecycle:

1. `edit_files` creates a patch artifact.
2. Controller transitions to `proposed`.
3. Promotion gate evaluates validators.
4. Controller transitions to `awaiting_approval` and then `validated` on success.
5. A human or supervising process records approval.
6. `applyPatchArtifact()` writes files.
7. Finalize emits the run summary.
