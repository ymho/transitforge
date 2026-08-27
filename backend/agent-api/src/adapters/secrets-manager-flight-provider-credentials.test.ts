import { describe, expect, it } from "vitest";
import { SecretsManagerFlightProviderCredentials } from "./secrets-manager-flight-provider-credentials.js";

describe("SecretsManagerFlightProviderCredentials", () => {
  it("航空便Providerの認証情報だけを読み込む", async () => {
    const repository = new SecretsManagerFlightProviderCredentials({
      async getSecretValue() {
        return { SecretString: JSON.stringify({
          application_id: "accommodation-id",
          amadeus_client_id: "flight-id",
          amadeus_client_secret: "flight-secret",
          amadeus_base_url: "https://test.api.amadeus.com",
        }) };
      },
    }, "arn:secret");

    await expect(repository.load()).resolves.toEqual({
      clientId: "flight-id",
      clientSecret: "flight-secret",
      baseUrl: "https://test.api.amadeus.com",
    });
  });

  it("未設定時は航空便検索を無効化できる", async () => {
    const repository = new SecretsManagerFlightProviderCredentials({
      async getSecretValue() { return { SecretString: "{}" }; },
    }, "arn:secret");

    await expect(repository.load()).resolves.toBeUndefined();
  });
});
