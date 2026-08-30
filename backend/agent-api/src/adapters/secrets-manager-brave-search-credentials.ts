import type { BraveSearchCredentialsRepository } from "../ports/brave-search-credentials.js";
import type { SecretsManagerClient } from "./secrets-manager-travel-provider-credentials.js";

export class SecretsManagerBraveSearchCredentials implements BraveSearchCredentialsRepository {
  constructor(private readonly client: SecretsManagerClient, private readonly secretArn: string) {}

  async load(): Promise<{ apiKey: string } | undefined> {
    if (!this.secretArn) return undefined;
    const { SecretString } = await this.client.getSecretValue({ SecretId: this.secretArn });
    if (typeof SecretString !== "string") return undefined;
    let value: unknown;
    try { value = JSON.parse(SecretString); } catch { return undefined; }
    if (!isRecord(value)) return undefined;
    const apiKey = optional(value.brave_search_api_key);
    return apiKey ? { apiKey } : undefined;
  }
}

function optional(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
