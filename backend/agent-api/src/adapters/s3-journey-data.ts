import { gunzipSync } from "node:zlib";

import type { JsonObject } from "../contracts/agent-request.js";
import type { JourneyDataRepository, JourneyIndexKind } from "../ports/journey-data.js";

export interface S3JourneyClient {
  headObject(input: { Bucket: string; Key: string }): Promise<{ ETag?: string }>;
  getObject(input: { Bucket: string; Key: string }): Promise<{ Body?: Uint8Array }>;
}

export interface S3JourneyDataOptions {
  indexBucket: string;
  indexPrefix: string;
  snapshotBucket?: string;
  snapshotKey?: string;
}

export class S3JourneyDataRepository implements JourneyDataRepository {
  private readonly cache = new Map<string, { etag: string; value: JsonObject }>();
  constructor(private readonly client: S3JourneyClient, private readonly options: S3JourneyDataOptions) {}

  async loadIndex(serviceDate: string, kind: JourneyIndexKind): Promise<JsonObject> {
    const filename = kind === "direct-service" ? "direct-service-index.json.gz" : "connection-index.json.gz";
    const schema = kind === "direct-service" ? "direct-service-index-v1" : "timetable-connection-index-v1";
    const prefix = this.options.indexPrefix.replace(/^\/+|\/+$/gu, "");
    const key = `${prefix}/normalized/${serviceDate}/${filename}`;
    try {
      const { ETag = "" } = await this.client.headObject({ Bucket: this.options.indexBucket, Key: key });
      const cached = this.cache.get(key);
      if (cached?.etag === ETag) return cached.value;
      const { Body } = await this.client.getObject({ Bucket: this.options.indexBucket, Key: key });
      if (!(Body instanceof Uint8Array)) throw new Error("missing body");
      const value: unknown = JSON.parse(gunzipSync(Body).toString("utf8"));
      if (!isRecord(value) || value.schema_version !== schema) throw new Error("invalid schema");
      this.cache.clear(); this.cache.set(key, { etag: ETag, value }); return value;
    } catch { throw new Error("指定日の検索インデックスを読み込めません。"); }
  }

  async loadRealtimeSnapshot(): Promise<JsonObject | undefined> {
    if (!this.options.snapshotBucket || !this.options.snapshotKey) return undefined;
    try {
      const { Body } = await this.client.getObject({ Bucket: this.options.snapshotBucket, Key: this.options.snapshotKey });
      if (!(Body instanceof Uint8Array)) return undefined;
      const value: unknown = JSON.parse(new TextDecoder().decode(Body));
      return isRecord(value) ? value : undefined;
    } catch { return undefined; }
  }
}

function isRecord(value: unknown): value is JsonObject { return typeof value === "object" && value !== null && !Array.isArray(value); }
