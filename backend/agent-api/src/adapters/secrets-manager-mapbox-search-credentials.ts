import type { MapboxSearchCredentialsRepository } from "../ports/mapbox-search-credentials.js";
import type { SecretsManagerClient } from "./secrets-manager-travel-provider-credentials.js";

export class SecretsManagerMapboxSearchCredentials implements MapboxSearchCredentialsRepository {
  constructor(
    private readonly client: SecretsManagerClient,
    private readonly secretArn: string,
  ) {}

  async load(): Promise<{ accessToken: string } | undefined> {
    if (!this.secretArn) return undefined;
    const { SecretString } = await this.client.getSecretValue({ SecretId: this.secretArn });
    if (typeof SecretString !== "string") return undefined;
    let value: unknown;
    try {
      value = JSON.parse(SecretString);
    } catch {
      return undefined;
    }
    if (!isRecord(value)) return undefined;
    const accessToken = optional(value.mapbox_search_access_token);
    return accessToken ? { accessToken } : undefined;
  }
}

function optional(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
