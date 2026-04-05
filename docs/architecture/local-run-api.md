
# Local Run API

V5 adds a dedicated local Run API above `packages/agent-kernel`.

## Purpose

The runtime gateway only handles model execution. The Run API handles bounded run lifecycle operations:

- create a run from an intent
- inspect run state
- inspect events and artifacts
- approve or reject a validated proposal
- apply an approved patch
- complete an applied run

## Canonical path

shell → run-api → agent-kernel → runtime-gateway → oMLX

## Core guarantees

- run lifecycle is exposed through one operator-facing API
- approval, apply, and complete remain separate actions
- the shell does not bypass the bounded kernel
