# Runtime + Shell Quickstart

1. Start oMLX.
2. Start `services/runtime-gateway/app.py`.
3. Bootstrap GSD model config if needed.
4. Run `agent-stack-shell status`.
5. Run `agent-stack-shell capabilities`.
6. Run `agent-stack-run "hello"` for a runtime-only prompt.

Mutating flows must go through `packages/agent-kernel` and stop for approval.
