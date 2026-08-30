import type { TravelProviderCredentials, TravelProviderCredentialsRepository } from "../ports/travel-provider.js";

export interface SecretsManagerClient {
  getSecretValue(input: { SecretId: string }): Promise<{ SecretString?: string }>;
}

export class SecretsManagerTravelProviderCredentials implements TravelProviderCredentialsRepository {
  constructor(private readonly client: SecretsManagerClient, private readonly secretArn: string) {}

  async load(): Promise<TravelProviderCredentials> {
    if (!this.secretArn) throw new Error("旅行提供者のシークレットARNが設定されていません。");
    const { SecretString } = await this.client.getSecretValue({ SecretId: this.secretArn });
    if (typeof SecretString !== "string") throw new Error("旅行提供者の認証情報が文字列ではありません。");
    let value: unknown;
    try { value = JSON.parse(SecretString); } catch { throw new Error("旅行提供者の認証情報はJSON形式にしてください。"); }
    if (!isRecord(value)) throw new Error("旅行提供者の認証情報はJSONオブジェクトにしてください。");
    const applicationId = required(value.application_id, "application_id");
    const accessKey = required(value.access_key, "access_key");
    const hotelSearchUrl = required(value.hotel_search_url, "hotel_search_url");
    assertHttpsUrl(hotelSearchUrl);
    const vacantHotelSearchUrl = value.vacant_hotel_search_url === undefined
      ? undefined
      : required(value.vacant_hotel_search_url, "vacant_hotel_search_url");
    if (vacantHotelSearchUrl) assertHttpsUrl(vacantHotelSearchUrl, "vacant_hotel_search_url");
    const affiliateId = value.affiliate_id === undefined ? undefined : required(value.affiliate_id, "affiliate_id");
    return {
      applicationId,
      accessKey,
      hotelSearchUrl,
      ...(vacantHotelSearchUrl ? { vacantHotelSearchUrl } : {}),
      ...(affiliateId ? { affiliateId } : {}),
    };
  }
}

function required(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`旅行提供者の${name}が必要です。`);
  return value.trim();
}
function assertHttpsUrl(value: string, name = "hotel_search_url"): void {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error();
  } catch { throw new Error(`旅行提供者の${name}はHTTPS URLにしてください。`); }
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
