import { describe, expect, it } from "vitest";
import { SecretsManagerMapboxSearchCredentials } from "./secrets-manager-mapbox-search-credentials.js";

describe("SecretsManagerMapboxSearchCredentials", () => {
  it("共有SecretからMapbox Search用Tokenだけを読み込む", async () => {
    const repository = new SecretsManagerMapboxSearchCredentials({
      async getSecretValue() {
        return { SecretString: JSON.stringify({ mapbox_search_access_token: " pk.search " }) };
      },
    }, "arn:secret");

    await expect(repository.load()).resolves.toEqual({ accessToken: "pk.search" });
  });

  it("Tokenが未設定なら他の旅行Toolを止めずundefinedを返す", async () => {
    const repository = new SecretsManagerMapboxSearchCredentials({
      async getSecretValue() {
        return { SecretString: JSON.stringify({ application_id: "accommodation" }) };
      },
    }, "arn:secret");

    await expect(repository.load()).resolves.toBeUndefined();
  });
});
