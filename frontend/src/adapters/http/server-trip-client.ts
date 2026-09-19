import { requestSessionVersion, subscribeRequestSession } from "./authenticated-fetch";
import { ApiAuthenticationError } from "../../usecases/auth/api-authentication-error";
import { personalApiFetch } from "./personal-api-fetch";
import { validateTrip, TripRevisionConflict, type Trip } from "@raiquora/trip/trip";
import { TripWriteRejected, type ServerTripClient, type ServerTripPage, type TripMutationRequest } from "../../usecases/trip-plan/server-trip-client";

/** No owner parameter/header. The common authenticated transport supplies only an Access Token. */
export class HttpServerTripClient implements ServerTripClient {
  private readonly roles = new Map<string, import("@raiquora/trip/trip-sharing").TripRole>();
  private rolesVersion = -1;
  private readonly mutationSessions = new Map<string, number>();
  sessionVersion() { return requestSessionVersion(this.request); }
  subscribeSessionChange(listener: () => void) { return subscribeRequestSession(this.request, listener); }
  getRole(tripId: string) {
    if (this.rolesVersion !== this.sessionVersion()) { this.roles.clear(); this.rolesVersion = this.sessionVersion(); }
    return this.roles.get(tripId);
  }
  constructor(private readonly endpoint = "/api/trips/v1", private readonly request: typeof fetch = personalApiFetch) {}
  private async execute(command: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
    const epoch = this.sessionVersion();
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
    if (epoch !== this.sessionVersion()) throw new ApiAuthenticationError("session-changed");
    if (!value || typeof value !== "object" || Array.isArray(value) || (value as { version?: unknown }).version !== "trip-api-v1") throw new Error("Invalid Trip API response");
    return value as Record<string, unknown>;
  }
  async get(tripId: string): Promise<Trip | undefined> {
    const epoch = this.sessionVersion();
    this.getRole(tripId);
    this.roles.delete(tripId);
    const result = await this.execute({ operation: "get", tripId });
    if (epoch !== this.sessionVersion()) throw new ApiAuthenticationError("session-changed");
    if (!result) return undefined;
    validateTrip(result.trip as Trip);
    if ((result.trip as Trip).id !== tripId) throw new Error("Wrong Trip response");
    if (result.role !== undefined) {
      if (result.role !== "owner" && result.role !== "editor" && result.role !== "viewer") throw new Error("Invalid Trip role");
      this.roles.set(tripId, result.role);
    }
    return structuredClone(result.trip as Trip);
  }
  async create(trip: Trip): Promise<Trip> {
    validateTrip(trip);
    const result = await this.execute({ operation: "create", trip });
    validateTrip(result?.trip as Trip);
    if ((result!.trip as Trip).id !== trip.id) throw new Error("Wrong Trip response");
    return structuredClone(result!.trip as Trip);
  }
  async list(page: { limit?: number; afterTripId?: string } = {}): Promise<ServerTripPage> {
    const result = await this.execute({ operation: "list", ...page });
    if (!Array.isArray(result?.trips) || !result.trips.every((trip) => { try { validateTrip(trip as Trip); return true; } catch { return false; } }) ||
        result.nextAfterTripId !== undefined && typeof result.nextAfterTripId !== "string") throw new Error("Invalid Trip API response");
    return { trips: structuredClone(result.trips as Trip[]), ...(result.nextAfterTripId ? { nextAfterTripId: result.nextAfterTripId } : {}) };
  }
  async archive(tripId: string): Promise<void> { await this.execute({ operation: "archive", tripId }); }
  async attach(conversationId: string, tripId: string): Promise<void> { await this.execute({ operation: "attach", conversationId, tripId }); }
  async mutate(mutation: TripMutationRequest): Promise<Trip> {
    const epoch = this.sessionVersion(), previous = this.mutationSessions.get(mutation.mutationId);
    if (previous !== undefined && previous !== epoch) throw new ApiAuthenticationError("session-changed");
    // Pending requests are document-local; keep their binding until reload, never evict into reuse.
    if (previous === undefined && this.mutationSessions.size >= 1024) throw new TripWriteRejected("画面を再読込して変更内容を確認してください");
    this.mutationSessions.set(mutation.mutationId, epoch);
    const result = await this.execute({ operation: "mutate", ...mutation });
    if (epoch !== this.sessionVersion()) throw new ApiAuthenticationError("session-changed");
    validateTrip(result?.trip as Trip);
    const trip = result!.trip as Trip;
    if (trip.id !== mutation.tripId || trip.revision !== mutation.baseRevision + 1 || result!.revision !== trip.revision || result!.mutationId !== mutation.mutationId) throw new Error("Invalid mutation response");
    return structuredClone(trip);
  }
  async detach(conversationId: string): Promise<void> { await this.execute({ operation: "detach", conversationId }); }
}
