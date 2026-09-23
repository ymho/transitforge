export type CapabilityStatus = "supported" | "unsupported" | "unmeasured";

export interface BedrockProviderCapabilities {
  capabilityVersion: "bedrock-capabilities-v1";
  modelId: string;
  api: "converse";
  region: string;
  structuredTextOutput: CapabilityStatus;
  strictToolUse: CapabilityStatus;
  streaming: CapabilityStatus;
  citations: CapabilityStatus;
  promptCaching: {
    mode: "implicit" | "explicit" | "none" | "unmeasured";
    checkpointFields: Array<"tools" | "system" | "messages">;
    minimumTokens?: number;
    maximumCheckpoints?: number;
    ttlSeconds?: number;
  };
  source: "aws-documentation" | "contract-probe" | "configuration";
  verifiedAt: string;
}

/**
 * Capability is configuration, never inferred by model-name substring.
 * The production Nova IDs intentionally remain unmeasured for newly introduced
 * explicit Structured Outputs until an approved contract probe records support.
 */
export function configuredBedrockCapabilities(
  modelId: string,
  region: string,
  overrides: Partial<Omit<BedrockProviderCapabilities, "modelId" | "region" | "capabilityVersion" | "api">> = {},
): BedrockProviderCapabilities {
  return {
    capabilityVersion: "bedrock-capabilities-v1",
    modelId,
    api: "converse",
    region,
    structuredTextOutput: "unmeasured",
    strictToolUse: "unmeasured",
    streaming: "supported",
    citations: "unmeasured",
    promptCaching: { mode: "unmeasured", checkpointFields: [] },
    source: "configuration",
    verifiedAt: "2026-09-22",
    ...overrides,
  };
}

/** Exact model-keyed configuration produced from reviewed documentation/probes. */
export function bedrockCapabilitiesFromConfiguration(
  modelId: string,
  region: string,
  configuration: string | undefined,
): BedrockProviderCapabilities {
  if (!configuration) return documentedCapability(modelId, region) ?? configuredBedrockCapabilities(modelId, region);
  let parsed: unknown;
  try { parsed = JSON.parse(configuration); } catch { throw new Error("BEDROCK_CAPABILITY_MATRIX_JSON is invalid"); }
  if (!record(parsed) || !record(parsed[modelId])) return documentedCapability(modelId, region) ?? configuredBedrockCapabilities(modelId, region);
  const value = parsed[modelId];
  const status = (input: unknown): CapabilityStatus => input === "supported" || input === "unsupported" || input === "unmeasured" ? input : "unmeasured";
  const cache = record(value.promptCaching) ? value.promptCaching : {};
  const mode = cache.mode === "implicit" || cache.mode === "explicit" || cache.mode === "none" || cache.mode === "unmeasured" ? cache.mode : "unmeasured";
  const checkpointFields = Array.isArray(cache.checkpointFields) ? cache.checkpointFields.filter((field): field is "tools" | "system" | "messages" =>
    field === "tools" || field === "system" || field === "messages") : [];
  return configuredBedrockCapabilities(modelId, region, {
    structuredTextOutput: status(value.structuredTextOutput), strictToolUse: status(value.strictToolUse),
    streaming: status(value.streaming), citations: status(value.citations),
    promptCaching: { mode, checkpointFields,
      ...(positive(cache.minimumTokens) ? { minimumTokens: cache.minimumTokens } : {}),
      ...(positive(cache.maximumCheckpoints) ? { maximumCheckpoints: cache.maximumCheckpoints } : {}),
      ...(positive(cache.ttlSeconds) ? { ttlSeconds: cache.ttlSeconds } : {}) },
    source: value.source === "aws-documentation" || value.source === "contract-probe" ? value.source : "configuration",
    verifiedAt: typeof value.verifiedAt === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value.verifiedAt) ? value.verifiedAt : "2026-09-23",
  });
}

const documentedNovaIds = new Set([
  "amazon.nova-lite-v1:0", "us.amazon.nova-lite-v1:0", "eu.amazon.nova-lite-v1:0",
  "amazon.nova-2-lite-v1:0", "us.amazon.nova-2-lite-v1:0", "eu.amazon.nova-2-lite-v1:0",
  "jp.amazon.nova-2-lite-v1:0", "global.amazon.nova-2-lite-v1:0",
]);
function documentedCapability(modelId: string, region: string): BedrockProviderCapabilities | undefined {
  if (!documentedNovaIds.has(modelId)) return undefined;
  return configuredBedrockCapabilities(modelId, region, {
    structuredTextOutput: "unsupported", strictToolUse: "unsupported", streaming: "supported", citations: "unmeasured",
    promptCaching: { mode: "explicit", checkpointFields: ["system", "messages"], minimumTokens: 1_024, maximumCheckpoints: 4, ttlSeconds: 300 },
    source: "aws-documentation", verifiedAt: "2026-09-23",
  });
}

function positive(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) > 0; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
