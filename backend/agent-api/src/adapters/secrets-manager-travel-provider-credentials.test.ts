import { describe, expect, it } from "vitest";

import { SecretsManagerTravelProviderCredentials } from "./secrets-manager-travel-provider-credentials.js";

describe("SecretsManagerTravelProviderCredentials", () => {
  it("秘密値を公開せず認証情報を読み込む", async () => {
    let secretId = "";
    const repository = new SecretsManagerTravelProviderCredentials({
      async getSecretValue(input) {
        secretId = input.SecretId;
        return { SecretString: JSON.stringify({ application_id: "application-123", access_key: "key-456", hotel_search_url: "https://provider.example/search", vacant_hotel_search_url: "https://provider.example/vacant", affiliate_id: "affiliate-789" }) };
      },
    }, "arn:secret:travel-provider");
    await expect(repository.load()).resolves.toEqual({ applicationId: "application-123", accessKey: "key-456", hotelSearchUrl: "https://provider.example/search", vacantHotelSearchUrl: "https://provider.example/vacant", affiliateId: "affiliate-789" });
    expect(secretId).toBe("arn:secret:travel-provider");
  });

  it("不正な認証情報を拒否する", async () => {
    const repository = new SecretsManagerTravelProviderCredentials({ async getSecretValue() { return { SecretString: "not-json" }; } }, "arn:secret");
    await expect(repository.load()).rejects.toThrow("JSON形式");
  });
});
