import type {
  FlightProviderCredentials,
  FlightProviderCredentialsRepository,
} from "../ports/flight-provider.js";
import type { SecretsManagerClient } from "./secrets-manager-travel-provider-credentials.js";

export class SecretsManagerFlightProviderCredentials implements FlightProviderCredentialsRepository {
  constructor(
    private readonly client: SecretsManagerClient,
    private readonly secretArn: string,
  ) {}

  async load(): Promise<FlightProviderCredentials | undefined> {
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
    const clientId = optional(value.amadeus_client_id);
    const clientSecret = optional(value.amadeus_client_secret);
    const baseUrl = optional(value.amadeus_base_url);
    if (!clientId || !clientSecret) return undefined;
    if (baseUrl && !isHttpsUrl(baseUrl)) return undefined;
    return { clientId, clientSecret, ...(baseUrl ? { baseUrl } : {}) };
  }
}

function optional(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
