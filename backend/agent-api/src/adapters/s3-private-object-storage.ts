import type {
  PrivateObject,
  PrivateObjectStorage,
} from "../ports/private-object-storage.js";

export interface S3PutObjectClient {
  putObject(input: {
    Bucket: string;
    Key: string;
    Body: Uint8Array;
    ContentType: string;
    ServerSideEncryption: "AES256";
  }): Promise<unknown>;
}

export class S3PrivateObjectStorage implements PrivateObjectStorage {
  constructor(private readonly client: S3PutObjectClient) {}

  async put(value: PrivateObject): Promise<void> {
    await this.client.putObject({
      Bucket: value.bucket,
      Key: value.key,
      Body: value.body,
      ContentType: value.contentType,
      ServerSideEncryption: value.encryption,
    });
  }
}
