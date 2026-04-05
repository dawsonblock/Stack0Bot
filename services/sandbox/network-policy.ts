export type NetworkPolicyDecision = {
  requested: 'allow' | 'deny';
  supported: boolean;
  enforced: boolean;
  actual: 'allow' | 'deny' | 'degraded';
  mode: 'isolated' | 'restricted';
};

export function evaluateNetworkPolicy(requested: 'allow' | 'deny'): NetworkPolicyDecision {
  const supported = false;
  if (requested === 'allow') {
    return { requested, supported, enforced: false, actual: 'allow', mode: 'restricted' };
  }
  return {
    requested,
    supported,
    enforced: supported,
    actual: supported ? 'deny' : 'degraded',
    mode: supported ? 'isolated' : 'restricted',
  };
}
