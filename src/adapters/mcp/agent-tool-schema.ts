import { z } from "zod";

import type { AgentToolInputSchema } from "../../application/agent/tool-contract";

interface JsonSchemaProperty {
  type?: unknown;
  description?: unknown;
  enum?: unknown;
  minimum?: unknown;
  maximum?: unknown;
  maxLength?: unknown;
  maxItems?: unknown;
  items?: unknown;
}

export function agentToolInputSchemaToZod(
  schema: AgentToolInputSchema,
): z.ZodObject<z.ZodRawShape> {
  const required = new Set(schema.required ?? []);
  const shape: Record<string, z.ZodType> = {};
  for (const [name, definition] of Object.entries(schema.properties)) {
    const property = propertySchema(definition);
    shape[name] = required.has(name) ? property : property.optional();
  }
  const object = z.object(shape);
  return schema.additionalProperties === false ? object.strict() : object;
}

function propertySchema(definition: unknown): z.ZodType {
  if (!isRecord(definition)) {
    throw new Error("Tool入力Schemaのプロパティ定義が不正です");
  }
  const property = definition as JsonSchemaProperty;
  const description = typeof property.description === "string"
    ? property.description
    : undefined;
  if (property.type === "string") {
    let value = stringSchema(property);
    return description === undefined ? value : value.describe(description);
  }
  if (property.type === "number" || property.type === "integer") {
    let value = z.number();
    if (property.type === "integer") value = value.int();
    if (typeof property.minimum === "number") value = value.min(property.minimum);
    if (typeof property.maximum === "number") value = value.max(property.maximum);
    return description === undefined ? value : value.describe(description);
  }
  if (property.type === "array") {
    let value = z.array(propertySchema(property.items));
    if (typeof property.maxItems === "number") value = value.max(property.maxItems);
    return description === undefined ? value : value.describe(description);
  }
  throw new Error(`未対応のTool入力Schema型です: ${String(property.type)}`);
}

function stringSchema(property: JsonSchemaProperty): z.ZodType {
  if (Array.isArray(property.enum) && property.enum.every((item) =>
    typeof item === "string")) {
    if (property.enum.length === 0) {
      throw new Error("Tool入力Schemaのenumが空です");
    }
    return z.enum(property.enum as [string, ...string[]]);
  }
  let value = z.string();
  if (typeof property.maxLength === "number") value = value.max(property.maxLength);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
