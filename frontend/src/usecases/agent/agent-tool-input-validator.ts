import {
  invalidAgentToolInput,
  validAgentToolInput,
  type AgentToolInputResult,
  type AgentToolInputSchema,
} from "./tool-contract";

/**
 * Tool AdapterとLive Evalで共有する、Agent Tool contractの構造検証。
 * 意味判断は行わず、モデルへ公開したJSON Schemaの決定論的な制約だけを検証する。
 */
export function validateAgentToolInput(
  schema: AgentToolInputSchema,
  value: unknown,
): AgentToolInputResult<Record<string, unknown>> {
  const failure = validateValue(value, schema, "入力");
  if (failure) return invalidAgentToolInput(failure);
  return validAgentToolInput(value as Record<string, unknown>);
}

function validateValue(
  value: unknown,
  rawSchema: unknown,
  path: string,
): string | undefined {
  if (!isRecord(rawSchema)) return undefined;
  const types = schemaTypes(rawSchema.type);
  if (types.length > 0 && !types.some((type) => matchesType(value, type))) {
    return `${path}の型がTool contractと一致しません。`;
  }
  if (Array.isArray(rawSchema.enum) && !rawSchema.enum.some((item) => sameValue(item, value))) {
    return `${path}は許可された値ではありません。`;
  }

  if (isRecord(value)) return validateObject(value, rawSchema, path);
  if (Array.isArray(value)) return validateArray(value, rawSchema, path);
  if (typeof value === "string") return validateString(value, rawSchema, path);
  if (typeof value === "number") return validateNumber(value, rawSchema, path);
  return undefined;
}

function validateObject(
  value: Record<string, unknown>,
  schema: Record<string, unknown>,
  path: string,
): string | undefined {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required)
    ? schema.required.filter((item): item is string => typeof item === "string")
    : [];
  const missing = required.find((key) => !(key in value));
  if (missing) return `${path}.${missing}は必須です。`;
  if (schema.additionalProperties === false) {
    const unknown = Object.keys(value).find((key) => !(key in properties));
    if (unknown) return `${path}.${unknown}はTool contractにありません。`;
  }
  for (const [key, item] of Object.entries(value)) {
    if (!(key in properties)) continue;
    const failure = validateValue(item, properties[key], `${path}.${key}`);
    if (failure) return failure;
  }
  return undefined;
}

function validateArray(
  value: unknown[],
  schema: Record<string, unknown>,
  path: string,
): string | undefined {
  if (typeof schema.minItems === "number" && value.length < schema.minItems) {
    return `${path}の要素数が不足しています。`;
  }
  if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
    return `${path}の要素数が上限を超えています。`;
  }
  if (schema.items === undefined) return undefined;
  for (const [index, item] of value.entries()) {
    const failure = validateValue(item, schema.items, `${path}[${index}]`);
    if (failure) return failure;
  }
  return undefined;
}

function validateString(
  value: string,
  schema: Record<string, unknown>,
  path: string,
): string | undefined {
  if (typeof schema.minLength === "number" && value.length < schema.minLength) {
    return `${path}が短すぎます。`;
  }
  if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
    return `${path}が長すぎます。`;
  }
  if (typeof schema.pattern === "string") {
    try {
      if (!new RegExp(schema.pattern, "u").test(value)) {
        return `${path}の形式が不正です。`;
      }
    } catch {
      return `${path}のTool contractが不正です。`;
    }
  }
  return undefined;
}

function validateNumber(
  value: number,
  schema: Record<string, unknown>,
  path: string,
): string | undefined {
  if (!Number.isFinite(value)) return `${path}は有限の数値で指定してください。`;
  if (schema.type === "integer" && !Number.isInteger(value)) {
    return `${path}は整数で指定してください。`;
  }
  if (typeof schema.minimum === "number" && value < schema.minimum) {
    return `${path}が下限未満です。`;
  }
  if (typeof schema.maximum === "number" && value > schema.maximum) {
    return `${path}が上限を超えています。`;
  }
  return undefined;
}

function schemaTypes(value: unknown): string[] {
  if (typeof value === "string") return [value];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case "object": return isRecord(value);
    case "array": return Array.isArray(value);
    case "string": return typeof value === "string";
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "integer": return typeof value === "number" && Number.isInteger(value);
    case "boolean": return typeof value === "boolean";
    case "null": return value === null;
    default: return true;
  }
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
