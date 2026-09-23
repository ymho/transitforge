import { expect, it } from "vitest";
import { compileBedrockSchema } from "./bedrock-schema-compiler.js";
import { configuredBedrockCapabilities } from "./bedrock-provider-capabilities.js";

it("projects the provider subset while preserving property names and recording application constraints", () => {
  const result = compileBedrockSchema({ type: "object", properties: { days: { type: "integer", minimum: 1 }, name: { type: "string", minLength: 2 } },
    required: ["days"], additionalProperties: true }, configuredBedrockCapabilities("model", "region"));
  expect(result.schema).toEqual({ type: "object", properties: { days: { type: "integer" }, name: { type: "string" } }, required: ["days"], additionalProperties: false });
  expect(result.omittedConstraints).toEqual(["$.additionalProperties", "$.properties.days.minimum", "$.properties.name.minLength"]);
  expect(result.mode).toBe("application_strict");
});
