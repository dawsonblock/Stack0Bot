# Shell Runtime Boundary

The shell must not import runtime internals directly.

## Rules

- GSD talks to the runtime through the gateway only.
- Shell-visible health and capability state comes from gateway endpoints.
- Bearer auth is optional but supported at the seam.
- Runtime overload or unavailability should appear as explicit shell-visible status, not opaque provider errors.

## Why

This reduces cross-process coupling and makes it easier to swap or upgrade the runtime without rewriting shell logic.
