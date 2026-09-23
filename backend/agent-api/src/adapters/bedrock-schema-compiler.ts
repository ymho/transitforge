import type { JsonObject } from "../contracts/agent-request.js";
import type { BedrockProviderCapabilities } from "./bedrock-provider-capabilities.js";

export interface CompiledProviderSchema {
  schema: JsonObject;
  mode: "provider_strict" | "application_strict";
  omittedConstraints: string[];
}

const supported = new Set([
  "type", "properties", "required", "additionalProperties", "description", "enum", "const",
  "anyOf", "allOf", "$ref", "$defs", "definitions", "format", "items", "minItems",
]);
const applicationOnly = new Set([
  "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
  "minLength", "maxLength", "pattern", "maxItems", "uniqueItems",
]);

export function compileBedrockSchema(
  canonical: JsonObject,
  capabilities: BedrockProviderCapabilities,
): CompiledProviderSchema {
  const omitted = new Set<string>();
  const schema = project(canonical, "$", omitted) as JsonObject;
  if (schema.type === "object") schema.additionalProperties = false;
  return {
    schema,
    mode: capabilities.structuredTextOutput === "supported" || capabilities.strictToolUse === "supported"
      ? "provider_strict" : "application_strict",
    omittedConstraints: [...omitted].sort(),
  };
}

function project(value: unknown, path: string, omitted: Set<string>): unknown {
  if (Array.isArray(value)) return value.map((entry, index) => project(entry, `${path}[${index}]`, omitted));
  if (!isRecord(value)) return value;
  const output: JsonObject = {};
  for (const [key, nested] of Object.entries(value)) {
    if (applicationOnly.has(key)) { omitted.add(`${path}.${key}`); continue; }
    if (!supported.has(key)) { omitted.add(`${path}.${key}`); continue; }
    if (key === "additionalProperties" && nested !== false) { omitted.add(`${path}.${key}`); output[key] = false; continue; }
    if (key === "minItems" && nested !== 0 && nested !== 1) { omitted.add(`${path}.${key}`); continue; }
    if ((key === "properties" || key === "$defs" || key === "definitions") && isRecord(nested)) {
      output[key] = Object.fromEntries(Object.entries(nested).map(([name, definition]) =>
        [name, project(definition, `${path}.${key}.${name}`, omitted)]));
    } else output[key] = project(nested, `${path}.${key}`, omitted);
  }
  return output;
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
