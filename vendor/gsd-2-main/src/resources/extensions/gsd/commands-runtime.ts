import type { ExtensionCommandContext } from "@gsd/pi-coding-agent";

const DEFAULT_GATEWAY = process.env.GSD_RUNTIME_GATEWAY_URL || "http://127.0.0.1:8787";
const DEFAULT_TIMEOUT_MS = Number(process.env.GSD_RUNTIME_GATEWAY_TIMEOUT_MS || 8000);

interface RuntimeHealthResponse {
  ok?: boolean;
  omlx_base_url?: string;
  status_code?: number;
  error?: string;
}

interface RuntimeCapabilitiesResponse {
  runtime?: string;
  gateway?: string;
  capabilities?: Record<string, unknown>;
}

interface RuntimeModelsResponse {
  data?: Array<{ id?: string; object?: string }>;
}

function gatewayHeaders(): Record<string, string> {
  const token = (process.env.GSD_RUNTIME_GATEWAY_BEARER || "").trim();
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function fetchJson<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(`${DEFAULT_GATEWAY}${path}`, {
      method: "GET",
      headers: gatewayHeaders(),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json() as T;
  } finally {
    clearTimeout(timeout);
  }
}

function formatRuntimeStatus(health: RuntimeHealthResponse, caps: RuntimeCapabilitiesResponse, modelCount: number): string {
  const lines: string[] = ["Runtime Gateway Status\n"];
  lines.push(`  Gateway URL: ${DEFAULT_GATEWAY}`);
  lines.push(`  Healthy:     ${health.ok ? "yes" : "no"}`);
  if (health.omlx_base_url) {
    lines.push(`  Runtime URL: ${health.omlx_base_url}`);
  }
  if (typeof health.status_code === "number") {
    lines.push(`  Runtime code:${String(health.status_code).padStart(4, " ")}`);
  }
  if (health.error) {
    lines.push(`  Error:       ${health.error}`);
  }
  lines.push(`  Runtime:     ${caps.runtime || "unknown"}`);
  lines.push(`  Gateway:     ${caps.gateway || "runtime-gateway"}`);
  lines.push(`  Models:      ${modelCount}`);

  const capabilityKeys = Object.entries(caps.capabilities || {})
    .filter(([, value]) => Boolean(value))
    .map(([key]) => key)
    .sort();
  if (capabilityKeys.length > 0) {
    lines.push("");
    lines.push("  Enabled capabilities:");
    for (const key of capabilityKeys) {
      lines.push(`    - ${key}`);
    }
  }
  return lines.join("\n");
}

function formatCapabilities(caps: RuntimeCapabilitiesResponse): string {
  const lines: string[] = ["Runtime Capabilities\n"];
  lines.push(`  Gateway URL: ${DEFAULT_GATEWAY}`);
  lines.push(`  Runtime:     ${caps.runtime || "unknown"}`);
  lines.push(`  Gateway:     ${caps.gateway || "runtime-gateway"}`);
  lines.push("");
  const entries = Object.entries(caps.capabilities || {}).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) {
    lines.push("  No capabilities reported.");
    return lines.join("\n");
  }
  for (const [key, value] of entries) {
    lines.push(`  ${key}: ${value ? "enabled" : "disabled"}`);
  }
  return lines.join("\n");
}

function formatModels(models: RuntimeModelsResponse): string {
  const items = Array.isArray(models.data) ? models.data : [];
  const lines: string[] = ["Runtime Models\n"];
  lines.push(`  Gateway URL: ${DEFAULT_GATEWAY}`);
  lines.push(`  Count:       ${items.length}`);
  if (items.length === 0) {
    lines.push("\n  No models reported by the runtime.");
    return lines.join("\n");
  }
  lines.push("");
  for (const model of items.slice(0, 50)) {
    lines.push(`  - ${model.id || "unknown-model"}`);
  }
  if (items.length > 50) {
    lines.push(`  ... ${items.length - 50} more`);
  }
  return lines.join("\n");
}

export async function handleRuntime(args: string, ctx: ExtensionCommandContext): Promise<void> {
  const trimmed = args.trim().toLowerCase();

  if (trimmed === "" || trimmed === "status" || trimmed === "check") {
    try {
      const [health, caps, models] = await Promise.all([
        fetchJson<RuntimeHealthResponse>("/healthz"),
        fetchJson<RuntimeCapabilitiesResponse>("/v1/capabilities"),
        fetchJson<RuntimeModelsResponse>("/v1/models").catch(() => ({ data: [] })),
      ]);
      const modelCount = Array.isArray(models.data) ? models.data.length : 0;
      ctx.ui.notify(formatRuntimeStatus(health, caps, modelCount), health.ok ? "info" : "warning");
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify([
        "Runtime Gateway Status\n",
        `  Gateway URL: ${DEFAULT_GATEWAY}`,
        "  Healthy:     no",
        `  Error:       ${message}`,
        "",
        "Start the stack with scripts/start-stack.sh or verify the gateway URL/token.",
      ].join("\n"), "warning");
      return;
    }
  }

  if (trimmed === "capabilities") {
    try {
      const caps = await fetchJson<RuntimeCapabilitiesResponse>("/v1/capabilities");
      ctx.ui.notify(formatCapabilities(caps), "info");
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`Failed to read runtime capabilities from ${DEFAULT_GATEWAY}: ${message}`, "warning");
      return;
    }
  }

  if (trimmed === "models") {
    try {
      const models = await fetchJson<RuntimeModelsResponse>("/v1/models");
      ctx.ui.notify(formatModels(models), "info");
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`Failed to read runtime models from ${DEFAULT_GATEWAY}: ${message}`, "warning");
      return;
    }
  }

  if (trimmed === "health") {
    try {
      const health = await fetchJson<RuntimeHealthResponse>("/healthz");
      const lines = [
        "Runtime Health\n",
        `  Gateway URL: ${DEFAULT_GATEWAY}`,
        `  Healthy:     ${health.ok ? "yes" : "no"}`,
        `  Runtime URL: ${health.omlx_base_url || "unknown"}`,
        ...(typeof health.status_code === "number" ? [`  Runtime code:${String(health.status_code).padStart(4, " ")}`] : []),
        ...(health.error ? [`  Error:       ${health.error}`] : []),
      ];
      ctx.ui.notify(lines.join("\n"), health.ok ? "info" : "warning");
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`Failed to read runtime health from ${DEFAULT_GATEWAY}: ${message}`, "warning");
      return;
    }
  }

  ctx.ui.notify(
    "Usage: /gsd runtime [status|health|capabilities|models]\n\n" +
    "  status        Show runtime health, model count, and enabled capabilities\n" +
    "  health        Probe the gateway and upstream runtime\n" +
    "  capabilities  Show capability flags reported by the gateway\n" +
    "  models        List models exposed through the runtime",
    "warning",
  );
}
