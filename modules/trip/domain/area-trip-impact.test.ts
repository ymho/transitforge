import { describe, expect, it } from "vitest";
import { areaInput, areaWeatherEvent, areaHazardEvent, areaZoned, areaNow } from "./area-trip-impact.fixture";
import { evaluateAreaTripImpact, type VerifiedWeatherSensitivity } from "./area-trip-impact";
import { travelEventId } from "./travel-event";
import { validateTripImpact } from "./trip-impact";

const sensitive = (input: ReturnType<typeof areaInput>): VerifiedWeatherSensitivity[] => [{ itemId: "activity", area: input.event.subject.type === "rail-service" ? "" : input.event.subject.area,
  kind: "precipitation-sensitive", verifiedAt: areaNow, sources: [{ id: "verified-sensitivity", kind: "place", provider: "synthetic", sourceId: "sensitivity",
    retrievedAt: areaNow, validUntil: "2026-09-12T09:00:00Z", confidence: "observed" }] }];
describe("weather/hazard × adopted Trip", () => {
  it("records exact fixed overlap and preserves plan/inputs; no title-based sensitivity or severity", () => {
    const input = areaInput(), before = structuredClone(input), result = evaluateAreaTripImpact(input);
    expect(input).toEqual(before); expect(result.status).toBe("unknown"); expect(result.severity).toBe("informational");
    expect(result.facts.filter((f) => f.type === "weather-exposure")).toMatchObject([{ relevance: "definite", intervalStartAt: areaZoned(17), intervalEndAt: areaZoned(18) }]);
    expect(result.facts).toContainEqual({ type: "uncertainty", itemId: "activity", reason: "weather_sensitivity" });
  });
  it("verified precipitation sensitivity + actual schedule overlap gives attention, never amplitude-only action/critical", () => {
    const input = areaInput();
    expect(evaluateAreaTripImpact({ ...input, weatherSensitivity: sensitive(input) })).toMatchObject({ status: "impact", severity: "attention" });
    const event = areaWeatherEvent(); if (event.kind !== "weather" || event.fact.status !== "observed") throw new Error();
    Object.assign(event.fact.forecast[1]!, { temperatureCelsius: 45, precipitationMillimeters: 100 });
    const severe = areaInput({ ...event, id: travelEventId(event) });
    expect(evaluateAreaTripImpact(severe).severity).toBe("informational");
  });
  it("precipitation at 18:00 belongs to 17:00–18:00, not 18:00–19:00; instantaneous fields retain sampleAt", () => {
    const event = areaWeatherEvent(); if (event.kind !== "weather" || event.fact.status !== "observed") throw new Error();
    const changed = { ...event, fact: { ...event.fact, forecast: event.fact.forecast.map((h, i) => ({ ...h, precipitationMillimeters: i === 1 ? 8 : 0 })) } };
    const source = { ...changed, id: travelEventId(changed) };
    const before = areaInput(source), after = areaInput(source, { type: "fixed", startAt: areaZoned(18), endAt: areaZoned(19) });
    const rain = evaluateAreaTripImpact({ ...before, weatherSensitivity: sensitive(before) });
    expect(rain.severity).toBe("attention");
    expect(rain.facts).toContainEqual(expect.objectContaining({ type: "weather-exposure", sampleAt: areaZoned(18), intervalStartAt: areaZoned(17), precipitationMillimeters: 8 }));
    expect(evaluateAreaTripImpact({ ...after, weatherSensitivity: sensitive(after) }).status).toBe("no-impact");
  });
  it("no overlap / out of range is unknown, not sunny or safe", () => {
    const input = areaInput(areaWeatherEvent(), { type: "fixed", startAt: areaZoned(20), endAt: areaZoned(21) });
    const result = evaluateAreaTripImpact(input);
    expect(result.status).toBe("unknown"); expect(result.facts.some((f) => f.type === "weather-exposure")).toBe(false);
  });
  it.each([60, 180])("window duration %i retains definite vs possible placement", (durationMinutes) => {
    const input = areaInput(areaWeatherEvent(), { type: "window", earliestStart: areaZoned(16), latestEnd: areaZoned(20), durationMinutes });
    const result = evaluateAreaTripImpact(input), facts = result.facts.filter((f) => f.type === "weather-exposure");
    expect(facts).toHaveLength(4);
    expect(facts.some((f) => f.relevance === "definite")).toBe(durationMinutes === 180);
    expect(result.facts).toContainEqual({ type: "weather-placement", itemId: "activity", area: "trusted:osaka-cell-1", phenomenon: "precipitation", relevance: "definite" });
  });
  it("day is date-only, unscheduled is unknown, never a midnight fixed appointment", () => {
    const day = areaInput(areaWeatherEvent(), { type: "day", date: "2026-09-12", timeZone: "Asia/Tokyo" });
    expect(evaluateAreaTripImpact(day).facts.filter((f) => f.type === "weather-exposure").every((f) => f.relevance === "date-only")).toBe(true);
    expect(day.trip.items[0]!.schedule.type).toBe("day");
    const result = evaluateAreaTripImpact(areaInput(areaWeatherEvent(), { type: "unscheduled" }));
    expect(result.status).toBe("unknown"); expect(result.facts.some((f) => f.type === "weather-exposure")).toBe(false);
  });
  it.each(["definite", "possible", "none"])("window precipitation union: %s", (mode) => {
    const event = areaWeatherEvent(); if (event.kind !== "weather" || event.fact.status !== "observed") throw new Error();
    const changed = { ...event, fact: { ...event.fact, forecast: event.fact.forecast.map((h, i) => ({ ...h,
      precipitationMillimeters: mode === "none" ? 0 : mode === "possible" && i !== 1 ? 0 : 3 })) } };
    const input = areaInput({ ...changed, id: travelEventId(changed) }, { type: "window", earliestStart: areaZoned(16), latestEnd: areaZoned(20), durationMinutes: 60 });
    const result = evaluateAreaTripImpact({ ...input, weatherSensitivity: sensitive(input) });
    expect(result.facts).toContainEqual({ type: "weather-placement", itemId: "activity", area: "trusted:osaka-cell-1", phenomenon: "precipitation", relevance: mode });
    expect(result.status).toBe(mode === "definite" ? "impact" : mode === "possible" ? "unknown" : "no-impact");
  });
  it("day scope uses its explicit timezone, not forecast or host calendar date", () => {
    const result = evaluateAreaTripImpact(areaInput(areaWeatherEvent(), { type: "day", date: "2026-09-11", timeZone: "Pacific/Honolulu" }));
    expect(result.facts.filter((f) => f.type === "weather-exposure")).toHaveLength(3);
    const noZone = evaluateAreaTripImpact(areaInput(areaWeatherEvent(), { type: "day", date: "2026-09-12" }));
    expect(noZone.facts.some((f) => f.type === "weather-exposure")).toBe(false);
  });
  it.each(["stale", "unavailable", "future-evidence"])("hazard %s cannot assert exposure/safety", (mode) => {
    const event = areaHazardEvent();
    const changed = mode === "stale" ? { ...event, freshness: "stale" as const } : mode === "unavailable"
      ? { ...event, fact: { status: "unavailable" as const, reason: "failed" as const } }
      : { ...event, sources: event.sources.map((s) => ({ ...s, retrievedAt: "2026-09-12T08:01:00Z" })) };
    const result = evaluateAreaTripImpact(areaInput({ ...changed, id: travelEventId(changed) }));
    expect(result.status).toBe("unknown"); expect(result.facts.some((f) => f.type === "hazard-exposure")).toBe(false);
  });
  it("rejects invented or stale weather sensitivity without upgrading severity", () => {
    const input = areaInput(), entries = sensitive(input);
    entries[0]!.sources[0]!.confidence = "unknown";
    expect(() => evaluateAreaTripImpact({ ...input, weatherSensitivity: entries })).toThrow();
    entries[0]!.sources[0]!.confidence = "observed"; entries[0]!.sources[0]!.validUntil = "2026-09-12T07:00:00Z";
    expect(evaluateAreaTripImpact({ ...input, weatherSensitivity: entries }).status).toBe("unknown");
  });
  it("gaps in forecast do not certify full interval coverage", () => {
    const event = areaWeatherEvent(); if (event.kind !== "weather" || event.fact.status !== "observed") throw new Error();
    const changed = { ...event, fact: { ...event.fact, forecast: event.fact.forecast.filter((_, i) => i !== 1) } };
    const result = evaluateAreaTripImpact(areaInput({ ...changed, id: travelEventId(changed) }));
    expect(result.status).toBe("unknown"); expect(result.facts).toContainEqual({ type: "uncertainty", itemId: "activity", reason: "forecast_coverage" });
  });
  it.each(["stale", "unavailable", "expired"])("%s external data remains unknown without exposure", (mode) => {
    const event = areaWeatherEvent();
    const changed = mode === "unavailable" ? { ...event, fact: { status: "unavailable" as const, reason: "failed" as const } } : mode === "stale" ? { ...event, freshness: "stale" as const } : event;
    const input = areaInput({ ...changed, id: travelEventId(changed) });
    if (mode === "expired") input.evaluatedAt = "2026-09-12T10:00:00Z";
    const result = evaluateAreaTripImpact(input); expect(result.status).toBe("unknown"); expect(result.facts.every((f) => f.type === "uncertainty")).toBe(true);
  });
  it("hazard emergency is query-limited exposure, not facility danger/critical; free text is not interpreted", () => {
    const event = areaHazardEvent(), input = areaInput(event), result = evaluateAreaTripImpact(input);
    expect(result.severity).toBe("attention"); expect(result.facts).toContainEqual(expect.objectContaining({ type: "hazard-exposure", publicSeverity: "emergency", coverage: "query-limited" }));
    expect(result.facts).toContainEqual({ type: "uncertainty", itemId: "activity", reason: "hazard_validity" });
    if (event.kind !== "hazard" || event.fact.status !== "observed") throw new Error();
    Object.assign(event.fact.alerts[0]!, { title: "大阪は対象外", summary: "別市に限定との自由文" });
    expect(evaluateAreaTripImpact(areaInput({ ...event, id: travelEventId(event) })).facts).toEqual(result.facts);
  });
  it("empty feed is not safety, and future hazard applicability is not invented", () => {
    const event = areaHazardEvent(); if (event.kind !== "hazard" || event.fact.status !== "observed") throw new Error();
    const empty = { ...event, fact: { ...event.fact, alerts: [] } };
    expect(evaluateAreaTripImpact(areaInput({ ...empty, id: travelEventId(empty) })).status).toBe("unknown");
    const future = evaluateAreaTripImpact(areaInput(event, { type: "day", date: "2026-09-13", timeZone: "Asia/Tokyo" }));
    expect(future.status).toBe("unknown"); expect(future.facts.some((f) => f.type === "hazard-exposure")).toBe(false);
  });
  it.each(["subject", "revision", "schedule"])("rejects %s Watch binding mismatch", (mode) => {
    const input = areaInput();
    const w = input.watches[0]!;
    if (mode === "subject") Object.assign(w, { subject: { type: "weather-area", area: "unrelated" } });
    if (mode === "revision") Object.assign(w, { sourceTripRevision: 99 });
    if (mode === "schedule") Object.assign(w, { activeWindow: { type: "unscheduled" } });
    expect(() => evaluateAreaTripImpact(input)).toThrow();
  });
  it("same result is deterministic; strict typed facts exclude raw/notification data", () => {
    const input = areaInput(), a = evaluateAreaTripImpact(input), b = evaluateAreaTripImpact({ ...input, evaluatedAt: "2026-09-12T08:00:01Z" });
    expect(b.id).toBe(a.id); expect(() => validateTripImpact({ ...a, sent: true } as never)).toThrow();
    Object.assign(a.facts[0]!, { providerRaw: {} }); expect(() => validateTripImpact(a)).toThrow();
  });
});
