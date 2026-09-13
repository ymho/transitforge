import { validateTrip, TripRevisionConflict, type Trip } from "@raiquora/trip/trip";
import { TripWriteRejected, type ServerTripClient, type TripMutationRequest } from "../../usecases/trip-plan/server-trip-client";

/** No owner parameter/header. The future authenticated transport supplies the session, not identity claims in JSON. */
export class HttpServerTripClient implements ServerTripClient {
  constructor(private readonly endpoint = "/api/trips/v1", private readonly request: typeof fetch = fetch) {}
  private async execute(command: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
    const response = await this.request(this.endpoint, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: "trip-api-v1", ...command }), signal: AbortSignal.timeout(15_000) });
    if (response.status === 404 && command.operation === "get") return undefined;
    if (!response.ok) {
      if (response.status === 409) {
        const error = await response.json() as { version?: unknown; error?: unknown };
        if (error.version === "trip-api-v1" && error.error === "conflict") throw new TripRevisionConflict();
        if (error.version === "trip-api-v1" && error.error === "confirmation-required") throw new TripWriteRejected("予約済みの予定への影響を確認し、変更案を確認し直してください");
        if (error.version === "trip-api-v1" && error.error === "feasibility-required") throw new TripWriteRejected("旅程の成立性が未確認または不成立のため、準備完了にはできません。最新の旅程と取得情報を確認してください");
        throw new TripWriteRejected("変更を保存できません。変更案を確認し直してください");
      }
      if (command.operation === "mutate" && [400, 401, 403, 404, 413].includes(response.status)) throw new TripWriteRejected("変更を保存できません。認証と変更内容を確認してください");
      throw new Error("Trip API unavailable");
    }
    const value: unknown = await response.json();
    if (!value || typeof value !== "object" || Array.isArray(value) || (value as { version?: unknown }).version !== "trip-api-v1") throw new Error("Invalid Trip API response");
    return value as Record<string, unknown>;
  }
  async get(tripId: string): Promise<Trip | undefined> {
    const result = await this.execute({ operation: "get", tripId });
    if (!result) return undefined;
    validateTrip(result.trip as Trip);
    if ((result.trip as Trip).id !== tripId) throw new Error("Wrong Trip response");
    return structuredClone(result.trip as Trip);
  }
  async create(trip: Trip): Promise<Trip> {
    validateTrip(trip);
    const result = await this.execute({ operation: "create", trip });
    validateTrip(result?.trip as Trip);
    if ((result!.trip as Trip).id !== trip.id) throw new Error("Wrong Trip response");
    return structuredClone(result!.trip as Trip);
  }
  async attach(conversationId: string, tripId: string): Promise<void> { await this.execute({ operation: "attach", conversationId, tripId }); }
  async mutate(mutation: TripMutationRequest): Promise<Trip> {
    const result = await this.execute({ operation: "mutate", ...mutation });
    validateTrip(result?.trip as Trip);
    const trip = result!.trip as Trip;
    if (trip.id !== mutation.tripId || trip.revision !== mutation.baseRevision + 1 || result!.revision !== trip.revision || result!.mutationId !== mutation.mutationId) throw new Error("Invalid mutation response");
    return structuredClone(trip);
  }
  async detach(conversationId: string): Promise<void> { await this.execute({ operation: "detach", conversationId }); }
}
