import { personalApiFetch } from "./personal-api-fetch";
import { validateTrip, type Trip } from "@raiquora/trip/trip";
import { validateReservationFact, type ReservationFact } from "@raiquora/trip/reservation";
import type { TripRole, SharedTripRole, TripParticipantView, ShareGrantView } from "@raiquora/trip/trip-sharing";
import type { TripSharingClient, TripShareLink } from "../../usecases/trip-plan/trip-sharing-client";

const invalid = () => new Error("Invalid sharing response");
function record(v: unknown): Record<string, unknown> { if (!v || typeof v !== "object" || Array.isArray(v)) throw invalid(); return v as Record<string, unknown>; }
function text(v: unknown): string { if (typeof v !== "string" || v.length > 1000) throw invalid(); return v; }
function version(v: unknown): number { if (!Number.isSafeInteger(v) || Number(v) < 0) throw invalid(); return Number(v); }
function role(v: unknown): TripRole { if (v !== "owner" && v !== "editor" && v !== "viewer") throw invalid(); return v; }
function sharedRole(v: unknown): SharedTripRole { const r = role(v); if (r === "owner") throw invalid(); return r; }
function grant(v: unknown): ShareGrantView { const r = record(v); return { id: text(r.id), tripId: text(r.tripId), role: sharedRole(r.role),
  version: version(r.version), createdAt: text(r.createdAt), expiresAt: text(r.expiresAt), ...(r.revokedAt ? { revokedAt: text(r.revokedAt) } : {}) }; }
function participant(v: unknown): TripParticipantView { const r = record(v); if (typeof r.active !== "boolean") throw invalid(); return {
  id: text(r.id), tripId: text(r.tripId), role: sharedRole(r.role), active: r.active, version: version(r.version), joinedAt: text(r.joinedAt), updatedAt: text(r.updatedAt) }; }
function array(v: unknown): unknown[] { if (!Array.isArray(v) || v.length > 20) throw invalid(); return v; }
export class HttpTripSharingClient implements TripSharingClient {
  constructor(private readonly request: typeof fetch = personalApiFetch, private readonly endpoint = "/api/trips/sharing/v1") {}
  private async execute(command: Record<string, unknown>) {
    const response = await this.request(this.endpoint, { method: "POST", credentials: "same-origin", cache: "no-store", referrerPolicy: "no-referrer",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ version: "trip-sharing-v1", ...command }), signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error("共有情報を取得・更新できません。認証、権限、有効期限を確認してください。");
    const value = record(await response.json()); if (value.version !== "trip-sharing-v1") throw invalid(); return value;
  }
  async create(tripId: string, r: SharedTripRole, expiresAt?: string) {
    const value = await this.execute({ operation: "create-grant", tripId, role: r, ...(expiresAt ? { expiresAt } : {}) });
    const g = grant(value.grant), secret = text(value.secret);
    if (g.tripId !== tripId || !/^[A-Za-z0-9_-]{43}$/.test(secret)) throw invalid();
    return { grant: g, secret };
  }
  async redeem(link: TripShareLink) { const v = await this.execute({ operation: "redeem", tripId: link.tripId, grantId: link.grantId, secret: link.secret });
    if (v.tripId !== link.tripId) throw invalid(); return { tripId: text(v.tripId), role: role(v.role) }; }
  async revoke(tripId: string, g: ShareGrantView) { await this.execute({ operation: "revoke-grant", tripId, grantId: g.id, baseVersion: g.version }); }
  async manage(tripId: string, after?: string) {
    const v = await this.execute({ operation: "manage", tripId, ...(after ? { after } : {}) });
    const participants = array(v.participants).map(participant), grants = array(v.grants).map(grant);
    if ([...participants, ...grants].some((p) => p.tripId !== tripId)) throw invalid();
    return { participants, grants, ...(v.after ? { after: text(v.after) } : {}) };
  }
  async participant(tripId: string, p: TripParticipantView, r: SharedTripRole, active: boolean) {
    await this.execute({ operation: "participant", tripId, participantId: p.id, baseVersion: p.version, role: r, active });
  }
  async accessible(afterTripId?: string) {
    const v = await this.execute({ operation: "accessible", ...(afterTripId ? { afterTripId } : {}) });
    return { trips: array(v.trips).map((v) => { const r = record(v); validateTrip(r.trip as Trip); return { trip: structuredClone(r.trip as Trip), role: role(r.role) }; }),
      ...(v.afterTripId ? { afterTripId: text(v.afterTripId) } : {}) };
  }
  async reservationFacts(tripId: string): Promise<ReservationFact[]> {
    const v = await this.execute({ operation: "reservation-facts", tripId });
    if (!Array.isArray(v.facts)) throw invalid();
    v.facts.forEach(validateReservationFact); return structuredClone(v.facts as ReservationFact[]);
  }
}
