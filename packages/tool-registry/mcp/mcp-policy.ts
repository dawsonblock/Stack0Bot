import { readFile } from 'node:fs/promises';

export type McpPolicyEntry = {
  name: string;
  category: 'research' | 'read_only' | 'mutating';
  source: string;
  purpose: string;
  requiresReview: boolean;
  requiresReceipts: boolean;
  enabled: boolean;
};

export type McpServerPolicy = {
  defaultAction: 'deny' | 'allow';
  approvedServers: McpPolicyEntry[];
};

export async function loadMcpPolicy(configPath: string): Promise<McpServerPolicy> {
  const raw = await readFile(configPath, 'utf8');
  return JSON.parse(raw) as McpServerPolicy;
}

export function canExecute(
  serverName: string,
  operationType: McpPolicyEntry['category'],
  policy: McpServerPolicy,
): { allowed: boolean; reason?: string } {
  const entry = policy.approvedServers.find((candidate) => candidate.name === serverName && candidate.enabled);
  if (!entry && policy.defaultAction === 'deny') {
    return { allowed: false, reason: `MCP server "${serverName}" rejected by allowlist policy` };
  }
  if (!entry) {
    return { allowed: true };
  }
  if (operationType === 'mutating' && entry.category !== 'mutating') {
    return { allowed: false, reason: `MCP server "${serverName}" is not approved for mutating operations` };
  }
  return { allowed: true };
}

export function enforceMcpAllowlist(
  serverName: string,
  operationType: McpPolicyEntry['category'],
  policy: McpServerPolicy,
): void {
  const result = canExecute(serverName, operationType, policy);
  if (!result.allowed) {
    throw new Error(result.reason || 'MCP server rejected by policy');
  }
}
