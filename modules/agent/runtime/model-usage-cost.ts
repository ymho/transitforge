import type { AgentModelUsage } from "./model-provider";

export interface ModelTokenRates {
  pricingVersion: string;
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
  cacheReadPerMillionUsd?: number;
  cacheWritePerMillionUsd?: number;
}

export interface ModelUsageCost {
  pricingVersion: string;
  totalInputTokens?: number;
  estimatedCostUsd?: number;
  incomplete: boolean;
}

/** Bedrock inputTokens excludes cache reads/writes; add each component exactly once. */
export function estimateModelUsageCost(usage: AgentModelUsage | undefined, rates: ModelTokenRates): ModelUsageCost {
  if (!usage) return { pricingVersion: rates.pricingVersion, incomplete: true };
  const inputs = [usage.inputTokens, usage.cacheReadInputTokens, usage.cacheWriteInputTokens];
  const totalInputTokens = inputs.some(value => value !== undefined)
    ? inputs.reduce<number>((sum, value) => sum + (value ?? 0), 0) : undefined;
  const requiredKnown = usage.inputTokens !== undefined && usage.outputTokens !== undefined &&
    (usage.cacheReadInputTokens === undefined || rates.cacheReadPerMillionUsd !== undefined) &&
    (usage.cacheWriteInputTokens === undefined || rates.cacheWritePerMillionUsd !== undefined);
  const estimatedCostUsd = requiredKnown ? ((usage.inputTokens! * rates.inputPerMillionUsd) +
    (usage.outputTokens! * rates.outputPerMillionUsd) +
    ((usage.cacheReadInputTokens ?? 0) * (rates.cacheReadPerMillionUsd ?? 0)) +
    ((usage.cacheWriteInputTokens ?? 0) * (rates.cacheWritePerMillionUsd ?? 0))) / 1_000_000 : undefined;
  return { pricingVersion: rates.pricingVersion, ...(totalInputTokens === undefined ? {} : { totalInputTokens }),
    ...(estimatedCostUsd === undefined ? {} : { estimatedCostUsd }), incomplete: !requiredKnown };
}
