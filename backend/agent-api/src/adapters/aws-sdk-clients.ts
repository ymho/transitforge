import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

import type { JsonObject } from "../contracts/agent-request.js";

export class AwsBedrockConverseClient {
  constructor(private readonly client = new BedrockRuntimeClient({})) {}
  async converse(input: JsonObject): Promise<unknown> {
    return this.client.send(new ConverseCommand(input as unknown as ConstructorParameters<typeof ConverseCommand>[0]));
  }
}

export class AwsDynamoDbQueryClient {
  constructor(private readonly client = new DynamoDBClient({})) {}
  async query(input: JsonObject): Promise<unknown> {
    return this.client.send(new QueryCommand(input as unknown as ConstructorParameters<typeof QueryCommand>[0]));
  }
}

export class AwsS3Client {
  constructor(private readonly client = new S3Client({})) {}
  async headObject(input: { Bucket: string; Key: string }): Promise<{ ETag?: string }> {
    const result = await this.client.send(new HeadObjectCommand(input));
    return { ...(result.ETag === undefined ? {} : { ETag: result.ETag }) };
  }
  async getObject(input: { Bucket: string; Key: string }): Promise<{ Body?: Uint8Array }> {
    const result = await this.client.send(new GetObjectCommand(input));
    return { ...(result.Body === undefined ? {} : { Body: await result.Body.transformToByteArray() }) };
  }
  async putObject(input: { Bucket: string; Key: string; Body: Uint8Array; ContentType: string; ServerSideEncryption: "AES256" }): Promise<unknown> {
    return this.client.send(new PutObjectCommand(input));
  }
}

export class AwsSecretsManagerClient {
  constructor(private readonly client = new SecretsManagerClient({})) {}
  async getSecretValue(input: { SecretId: string }): Promise<{ SecretString?: string }> {
    const result = await this.client.send(new GetSecretValueCommand(input));
    return { ...(result.SecretString === undefined ? {} : { SecretString: result.SecretString }) };
  }
}
