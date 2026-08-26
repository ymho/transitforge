import type { JsonObject } from "../contracts/agent-request.js";

export type JourneyIndexKind = "direct-service" | "connection";

export interface JourneyDataRepository {
  loadIndex(serviceDate: string, kind: JourneyIndexKind): Promise<JsonObject>;
  loadRealtimeSnapshot(): Promise<JsonObject | undefined>;
}
