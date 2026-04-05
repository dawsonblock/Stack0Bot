# GSD Shell Runtime Integration

## Goal

Surface runtime health and capability metadata at the shell boundary without deeply forking GSD.

## What changed in v2

The combined stack now patches the vendored GSD source with a new command family:

- `/gsd runtime`
- `/gsd runtime health`
- `/gsd runtime capabilities`
- `/gsd runtime models`

The command family reads from `GSD_RUNTIME_GATEWAY_URL` and optional `GSD_RUNTIME_GATEWAY_BEARER` and queries the runtime gateway instead of reaching into oMLX directly.

## Why this boundary matters

- GSD stays a control-plane shell
- oMLX stays the model runtime
- the gateway becomes the contract seam
- shell-visible runtime state becomes explicit instead of hidden in provider failures

## Current limitations

This patch is source-level only. It does not claim that the vendored GSD tree has been rebuilt or that upstream package internals are stable across future releases.
