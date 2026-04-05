# MCP Curation

Use MCP servers selectively.

## Baseline rules

- prefer official servers for write-capable integrations
- keep high-risk servers off by default
- require signed or otherwise verifiable receipts for destructive operations when possible
- maintain a local allowlist instead of letting any discovered server onto the execution path

See `configs/mcp/allowlist.yaml`.
