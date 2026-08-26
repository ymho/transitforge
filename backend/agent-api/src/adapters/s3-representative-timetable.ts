import { gunzipSync } from "node:zlib";

import type { JsonObject } from "../contracts/agent-request.js";
import type {
  RepresentativeTimetableKind,
  RepresentativeTimetableRepository,
} from "../ports/operation-data.js";

export interface S3TimetableClient {
  headObject(input: { Bucket: string; Key: string }): Promise<{ ETag?: string }>;
  getObject(input: { Bucket: string; Key: string }): Promise<{ Body?: Uint8Array }>;
}

export class S3RepresentativeTimetableRepository implements RepresentativeTimetableRepository {
  private readonly cache = new Map<RepresentativeTimetableKind, { etag: string; value: JsonObject }>();

  constructor(
    private readonly client: S3TimetableClient,
    private readonly bucket: string,
    private readonly prefix: string,
  ) {}

  async load(kind: RepresentativeTimetableKind): Promise<JsonObject> {
    const key = `${this.prefix.replace(/^\/+|\/+$/gu, "")}/${kind}.json.gz`;
    const { ETag = "" } = await this.client.headObject({ Bucket: this.bucket, Key: key });
    const cached = this.cache.get(kind);
    if (cached?.etag === ETag) return cached.value;
    const { Body } = await this.client.getObject({ Bucket: this.bucket, Key: key });
    if (!(Body instanceof Uint8Array)) throw new Error("Representative timetable body is invalid");
    const value: unknown = JSON.parse(gunzipSync(Body).toString("utf8"));
    if (!isRecord(value) || value.schema_version !== "ai-timetable-v1") {
      throw new Error("Representative timetable schema is invalid");
    }
    this.cache.set(kind, { etag: ETag, value });
    return value;
  }
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
