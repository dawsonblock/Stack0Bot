export type NetworkPolicyDecision = {
  requested: 'allow' | 'deny';
  supported: boolean;
  effective: 'allow' | 'deny' | 'degraded';
  mode: 'isolated' | 'restricted';
};

export function evaluateNetworkPolicy(requested: 'allow' | 'deny'): NetworkPolicyDecision {
  const supported = false;
  if (requested === 'allow') {
    return { requested, supported, effective: 'allow', mode: 'restricted' };
  }
  return { requested, supported, effective: supported ? 'deny' : 'degraded', mode: supported ? 'isolated' : 'restricted' };
}
