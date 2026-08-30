import { describe, expect, it } from "vitest";
import { SecretsManagerBraveSearchCredentials } from "./secrets-manager-brave-search-credentials.js";

describe("SecretsManagerBraveSearchCredentials", () => {
  it("共有SecretからWeb検索用Keyだけを読む", async () => {
    const repository = new SecretsManagerBraveSearchCredentials({
      async getSecretValue() { return { SecretString: JSON.stringify({ brave_search_api_key: " key " }) }; },
    }, "arn:secret");
    await expect(repository.load()).resolves.toEqual({ apiKey: "key" });
  });
});
