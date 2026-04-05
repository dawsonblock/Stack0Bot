# UI Clients

## Agent Cowork and similar desktop shells

Use desktop clients as thin shells. They should not own orchestration semantics or model-runtime state. Point them at the same gateway or provider path used by the shell.

## OpenClaw and tool-heavy personal assistants

Keep unified authentication and messaging/channel integrations outside the core coding-agent execution path. Integrate through explicit plugins, not by blending channel logic into the shell.
