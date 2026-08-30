import type { HotPepperCredentialsRepository } from "../ports/hot-pepper-credentials.js";
import type { SecretsManagerClient } from "./secrets-manager-travel-provider-credentials.js";

export class SecretsManagerHotPepperCredentials implements HotPepperCredentialsRepository {
  constructor(private readonly client: SecretsManagerClient, private readonly secretArn: string) {}
  async load(): Promise<{ apiKey: string } | undefined> {
    const { SecretString } = await this.client.getSecretValue({ SecretId: this.secretArn });
    if (typeof SecretString !== "string") return undefined;
    try {
      const value: unknown = JSON.parse(SecretString);
      return isRecord(value) && typeof value.hot_pepper_api_key === "string" && value.hot_pepper_api_key.trim()
        ? { apiKey: value.hot_pepper_api_key.trim() }
        : undefined;
    } catch { return undefined; }
  }
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
