import { describe, expect, it, vi } from "vitest";

import { S3PrivateObjectStorage } from "./s3-private-object-storage.js";

describe("S3PrivateObjectStorage", () => {
  it("maps the private storage port without exposing SDK types inward", async () => {
    const putObject = vi.fn(async () => ({}));
    const storage = new S3PrivateObjectStorage({ putObject });
    const body = new TextEncoder().encode("{}");

    await storage.put({
      bucket: "private-bucket",
      key: "agent-traces/record.json",
      body,
      contentType: "application/json",
      encryption: "AES256",
    });

    expect(putObject).toHaveBeenCalledWith({
      Bucket: "private-bucket",
      Key: "agent-traces/record.json",
      Body: body,
      ContentType: "application/json",
      ServerSideEncryption: "AES256",
    });
  });
});
