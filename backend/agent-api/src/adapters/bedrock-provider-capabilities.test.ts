import { describe, expect, it } from "vitest";
import { bedrockCapabilitiesFromConfiguration } from "./bedrock-provider-capabilities.js";

describe("Bedrock provider capability matrix", () => {
  it("uses reviewed exact model IDs and never substring guesses support", () => {
    expect(bedrockCapabilitiesFromConfiguration("amazon.nova-lite-v1:0", "us-east-1", undefined))
      .toMatchObject({ structuredTextOutput: "unsupported", strictToolUse: "unsupported",
        promptCaching: { mode: "explicit", checkpointFields: ["system", "messages"], ttlSeconds: 300 },
        source: "aws-documentation" });
    expect(bedrockCapabilitiesFromConfiguration("custom-amazon.nova-lite-v1:0-copy", "us-east-1", undefined))
      .toMatchObject({ structuredTextOutput: "unmeasured", strictToolUse: "unmeasured",
        promptCaching: { mode: "unmeasured", checkpointFields: [] } });
  });

  it("accepts an explicit per-model probe/configuration result without affecting other models", () => {
    const configuration = JSON.stringify({ "provider.model-v1:0": {
      structuredTextOutput: "supported", strictToolUse: "supported", streaming: "supported", citations: "unsupported",
      promptCaching: { mode: "explicit", checkpointFields: ["tools"], minimumTokens: 1_024, maximumCheckpoints: 4, ttlSeconds: 300 },
      source: "contract-probe", verifiedAt: "2026-09-23",
    } });
    expect(bedrockCapabilitiesFromConfiguration("provider.model-v1:0", "ap-northeast-1", configuration))
      .toMatchObject({ modelId: "provider.model-v1:0", region: "ap-northeast-1", structuredTextOutput: "supported",
        strictToolUse: "supported", promptCaching: { checkpointFields: ["tools"] }, source: "contract-probe" });
    expect(bedrockCapabilitiesFromConfiguration("provider.other-v1:0", "ap-northeast-1", configuration))
      .toMatchObject({ structuredTextOutput: "unmeasured", strictToolUse: "unmeasured" });
  });
});
