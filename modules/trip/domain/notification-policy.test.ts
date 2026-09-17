import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decideNotification, notificationRisk } from "./notification-policy";
import { validateNotification, notificationView, type NotificationEpisode, type ImpactNotificationObservation } from "./notification";
import { impactInput, impactNow, impactEvent } from "./rail-trip-impact.fixture";
import { evaluateRailTripImpact } from "./rail-trip-impact";
import { tripImpactId, type TripImpact } from "./trip-impact";
import { areaInput, areaNow } from "./area-trip-impact.fixture";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
function fixture(delay = 6, second = 0) {
  const input = impactInput(delay), at = new Date(Date.parse(impactNow) + second * 1000).toISOString();
  const impact = evaluateRailTripImpact(input);
  const observation: ImpactNotificationObservation = { tripId: impact.tripId, tripRevision: impact.tripRevision, impactId: impact.id, subjectKey: "dated-service-1",
    kind: "rail-operation", observedAt: at, evaluatedAt: at, expiresAt: new Date(Date.parse(at) + 300000).toISOString(), fresh: true };
  return { ...input, impact, observation, now: at };
}
const decision = (f = fixture(), previous?: NotificationEpisode) => decideNotification(f.trip, f.impact, f.observation, previous, f.now, hash);
function altered(f: ReturnType<typeof fixture>, fields: Partial<TripImpact>) {
  const b = { ...f.impact, ...fields }; const impact = { ...b, id: tripImpactId(b) };
  return { ...f, impact, observation: { ...f.observation, impactId: impact.id } };
}
describe("notification policy / independent episodes", () => {
  it("informational suppress; attention and action require typed risk", () => {
    expect(decision(fixture(0)).notification).toBeUndefined();
    expect(decision(fixture(3)).notification?.severity).toBe("attention");
    const d = decision(); expect(d.notification?.severity).toBe("action-required"); validateNotification(d.notification!);
    const missing = altered(fixture(), { facts: [] }); expect(decision(missing).action).toBe("unknown");
  });
  it("same Impact and same Event rechecks do not create duplicate notifications", () => {
    const first = decision(); expect(decision(fixture(), first.episode).reason).toBe("duplicate");
    const repeated = decision(fixture(6, 30), first.episode); expect(repeated.action).toBe("suppress"); expect(repeated.episode?.id).toBe(first.episode?.id);
  });
  it("severity escalation, margin 5 -> 2 -> required deficit, and 5 -> 10 minutes notify", () => {
    const a = decision(fixture(3)); const b = decision(fixture(6, 30), a.episode);
    expect(b.reason).toBe("risk-escalated");
    const five = decision(fixture(5)); expect(decision(fixture(10, 30), five.episode).reason).toBe("risk-escalated");
    const margin = (projected: number, second: number) => altered(fixture(3, second), { facts: [{ type: "connection-buffer", itemId: "rail", fromLegId: "leg-1", toLegId: "leg-2",
      requiredMinutes: 5, scheduledMinutes: 15, projectedMinutes: projected, departureBasis: "scheduled" }] });
    const p = decision(margin(10, 0)), q = decision(margin(7, 20), p.episode), r = decision(margin(4, 40), q.episode);
    expect(q.action).toBe("notify"); expect(r.action).toBe("notify");
  });
  it("A -> B -> A uses episode high-water mark, not Impact ID novelty", () => {
    const a = decision(fixture(6)), b = decision(fixture(12, 30), a.episode), again = decision(fixture(6, 60), b.episode);
    expect(again.notification).toBeUndefined(); expect(again.episode?.id).toBe(a.episode?.id);
    expect(b.notification?.id).not.toBe(a.notification?.id);
  });
  it("explicit fresh no-impact resolves action episode once; later A opens a new episode", () => {
    const a = decision(), safe = decision(fixture(0, 30), a.episode);
    expect(safe.action).toBe("resolve"); expect(safe.notification?.phase).toBe("resolved");
    expect(decision(fixture(0, 60), safe.episode).notification).toBeUndefined();
    const again = decision(fixture(6, 90), safe.episode); expect(again.episode?.id).not.toBe(a.episode?.id); expect(again.reason).toBe("new-episode");
    expect(decision(fixture(0)).notification).toBeUndefined();
  });
  it("unknown is never resolution, nor repeated routes=0 an input", () => {
    const a = decision(), unknown = altered(fixture(0, 20), { status: "unknown", severity: "informational", facts: [{ type: "uncertainty", itemId: "rail", reason: "external_data" }] });
    expect(decision(unknown, a.episode).episode?.state).toBe("open"); expect(decision(unknown, a.episode).notification).toBeUndefined();
  });
  it("stale Trip, terminal, removed item and stale/future observation do not notify", () => {
    const f = fixture();
    for (const trip of [undefined, { ...f.trip, revision: 1 }, { ...f.trip, lifecycleState: "cancelled" as const }, { ...f.trip, lifecycleState: "completed" as const }, { ...f.trip, items: [] }]) {
      expect(decideNotification(trip, f.impact, f.observation, undefined, f.now, hash).notification).toBeUndefined();
    }
    expect(decideNotification(f.trip, f.impact, f.observation, undefined, f.observation.expiresAt, hash).reason).toBe("stale-observation");
    expect(() => decision(f, { ...decision().episode!, tripRevision: 2 })).toThrow();
    expect(decision({ ...f, observation: { ...f.observation, fresh: false } }).action).toBe("unknown");
  });
  it("out-of-order observation cannot reopen/escalate episode", () => {
    const d = decision(fixture(6, 60)); expect(decision(fixture(30, 20), d.episode).reason).toBe("duplicate");
  });
  it("connection text uses exact typed minutes and preserves scheduled basis", () => {
    const d = decision(fixture(8)); expect(d.notification?.message).toContain("乗換余裕が2分"); expect(d.notification?.message).toContain("必要5分");
    expect(d.notification?.message).toContain("計画時刻"); expect(d.notification?.message).not.toMatch(/代替|別の列車/);
  });
  it("schedule risk and explicit cancellation messages do not invent alternatives", () => {
    const f = fixture(), input = impactInput(); input.event = impactEvent(0, "s1", { status: "observed", cancelled: true });
    expect(notificationRisk(evaluateRailTripImpact(input)).message).toContain("運休の観測");
    const i = altered(f, { affectedItemIds: ["rail", "next"], facts: [{ type: "schedule-risk", fromItemId: "rail", toItemId: "next", targetBasis: "fixed",
      projectedArrivalAt: { at: "2026-09-13T02:10:00Z", timeZone: "Asia/Tokyo" }, targetStartAt: { at: "2026-09-13T02:00:00Z", timeZone: "Asia/Tokyo" } }] }).impact;
    expect(notificationRisk(i).message).toContain("開始を10分超過");
  });
  it("weather micro-changes and query-limited hazard cannot become cancellation/danger claims", () => {
    const { trip, event } = areaInput();
    const hazard = { ...fixture().impact, tripId: trip.id, tripRevision: trip.revision, affectedItemIds: ["activity"], severity: "attention" as const, facts: [
      { type: "hazard-exposure" as const, itemId: "activity", area: "scope", providerAlertId: "alert", category: "warning" as const, publicSeverity: "emergency" as const, issuedAt: areaNow, coverage: "query-limited" as const, relevance: "observed-during" as const },
      { type: "uncertainty" as const, itemId: "activity", reason: "hazard_coverage" as const }, { type: "uncertainty" as const, itemId: "activity", reason: "hazard_validity" as const }] };
    const impact = { ...hazard, id: tripImpactId(hazard) }, o = { ...fixture().observation, tripId: trip.id, tripRevision: trip.revision, impactId: impact.id, kind: "hazard" as const,
      observedAt: areaNow, evaluatedAt: areaNow, expiresAt: new Date(Date.parse(areaNow) + 3600000).toISOString() };
    const d = decideNotification(trip, impact, o, undefined, areaNow, hash);
    expect(d.notification?.severity).toBe("attention"); expect(d.notification?.message).toContain("有効期間は未確認"); expect(d.notification?.message).toContain("危険と判定したものではありません");
    const exposure = { type: "weather-exposure" as const, itemId: "activity", area: "scope", intervalStartAt: { at: areaNow, timeZone: "Asia/Tokyo" }, intervalEndAt: { at: new Date(Date.parse(areaNow) + 3600000).toISOString(), timeZone: "Asia/Tokyo" }, sampleAt: { at: new Date(Date.parse(areaNow) + 3600000).toISOString(), timeZone: "Asia/Tokyo" }, relevance: "definite" as const, temperatureCelsius: 25, precipitationProbabilityPercent: 80, precipitationMillimeters: 3, weatherCode: 61 };
    const w = { ...impact, eventId: event.id, facts: [exposure] }, wi = { ...w, id: tripImpactId(w) }, wo = { ...o, kind: "weather" as const, impactId: wi.id };
    exposure.intervalStartAt.timeZone = "UTC"; exposure.intervalEndAt.timeZone = "UTC"; exposure.sampleAt.timeZone = "UTC";
    const wd = decideNotification(trip, { ...wi, id: tripImpactId(wi) }, { ...wo, impactId: tripImpactId(wi) }, undefined, areaNow, hash);
    expect(wd.notification?.message).toContain("中止を判断する情報ではありません");
    const w2 = { ...wi, facts: [{ ...exposure, precipitationMillimeters: 3.1 }] }, i2 = { ...w2, id: tripImpactId(w2) }, later = new Date(Date.parse(areaNow) + 30000).toISOString();
    expect(decideNotification(trip, i2, { ...wo, impactId: i2.id, observedAt: later, evaluatedAt: later }, wd.episode, later, hash).notification).toBeUndefined();
  });
  it("public view does not expose Impact identity or internal episode/private extras", () => {
    const n = decision().notification!; const view = notificationView(n, "current");
    expect(view).not.toHaveProperty("impactId"); expect(view).not.toHaveProperty("subjectKey");
    expect(() => validateNotification({ ...n, bookingReference: "private" } as never)).toThrow();
  });
});
