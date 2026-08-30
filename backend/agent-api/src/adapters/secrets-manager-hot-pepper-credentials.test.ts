import { describe, expect, it } from "vitest";
import { SecretsManagerHotPepperCredentials } from "./secrets-manager-hot-pepper-credentials.js";

describe("SecretsManagerHotPepperCredentials", () => {
  it("共有Secretから飲食店検索用Keyだけを読み込む", async () => {
    const repository = new SecretsManagerHotPepperCredentials({
      async getSecretValue() {
        return { SecretString: JSON.stringify({ hot_pepper_api_key: " restaurant-key " }) };
      },
    }, "arn:secret");

    await expect(repository.load()).resolves.toEqual({ apiKey: "restaurant-key" });
  });

  it("Keyが未設定なら他の旅行Toolを止めずundefinedを返す", async () => {
    const repository = new SecretsManagerHotPepperCredentials({
      async getSecretValue() {
        return { SecretString: JSON.stringify({ application_id: "accommodation" }) };
      },
    }, "arn:secret");

    await expect(repository.load()).resolves.toBeUndefined();
  });
});
