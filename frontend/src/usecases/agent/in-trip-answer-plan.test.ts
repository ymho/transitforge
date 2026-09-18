import { describe, expect, it } from "vitest";
import { inTripFixture } from "../../../../modules/trip/domain/in-trip-context.fixture";
import { inTripApplicationEvidence } from "./in-trip-application-evidence";
import { renderInTripAnswer, validInTripAnswerPlan, inTripPresentations, supportsInTripPresentation, type InTripAnswerPlan } from "./in-trip-answer-plan";
import { parseAgentDecisionSummary } from "./agent-decision-summary";
import { externalTravelEvidence } from "./external-travel-tools";
import { hazardInformation } from "../../../../modules/trip/domain/hazard-alert.fixture";
import { areaInput, areaHazardEvent, areaNow } from "../../../../modules/trip/domain/area-trip-impact.fixture";
import { buildInTripContext } from "@raiquora/trip/in-trip-context";
import { evaluateAreaTripImpact } from "@raiquora/trip/area-trip-impact";

describe("InTripAnswerPlan presentation boundary", () => {
  const values = () => inTripApplicationEvidence(inTripFixture().snapshot);
  const selection = (evidenceId: string, presentation: InTripAnswerPlan["evidence"][number]["presentation"]): InTripAnswerPlan => ({ evidence: [{ evidenceId, presentation }] });
  it.each(["both", "weather", "hazard"])("renders all saved %s environment facts from one pure bounded Evidence", (kind) => {
    const inputs = [areaInput(), areaInput(areaHazardEvent())].filter((_, i) => kind === "both" || i === (kind === "weather" ? 0 : 1));
    const trip = { ...inputs[0]!.trip, lifecycleState: "in_trip" as const };
    const snapshot = buildInTripContext(trip, { at: areaNow, timeZone: "UTC" }, { tripConfirmed: true,
      impacts: inputs.map((input) => ({ impact: evaluateAreaTripImpact({ ...input, trip }), observedAt: areaNow,
        expiresAt: "2026-09-12T09:00:00Z", fresh: true })) })!;
    const before = JSON.stringify(snapshot), evidence = inTripApplicationEvidence(snapshot);
    const bundle = evidence.filter((e) => e.references[0]?.sourceType === "trip-impact");
    expect(bundle).toHaveLength(1);
    const e = bundle[0]!, plan = selection(e.id, "environment-impact");
    expect(new Set(e.coverage)).toEqual(new Set(kind === "both" ? ["weather.impact", "hazard.impact"] : [`${kind}.impact`]));
    expect(inTripPresentations.filter((p) => supportsInTripPresentation(e, p))).toEqual(["environment-impact"]);
    expect(e.knowledgeKind).toBe(snapshot.impacts.items.some((i) => i.status === "unknown") ? "unverified_information" : "derived_value");
    expect(JSON.parse(String(e.facts.impacts))).toEqual(snapshot.impacts.items.map(({ reasonCodes: _reasonCodes, ...saved }) => saved));
    const rendered = renderInTripAnswer(plan, [e.id], evidence);
    expect(rendered.text.includes("天気の保存済み評価")).toBe(kind !== "hazard");
    expect(rendered.text.includes("警報の保存済み評価")).toBe(kind !== "weather");
    if (kind !== "weather") {
      expect(rendered.text).toContain("未確認:この施設への警報の正確な適用範囲");
      expect(rendered.text).toContain("未確認:警報の有効期間");
    }
    expect(rendered.text).toContain("実際の現在地や屋外にいるかは確認していません");
    expect(rendered.text).not.toMatch(/今は屋外です|現在この施設にいます|この施設は危険です/);
    expect(JSON.stringify(e)).not.toMatch(/providerAlertId|providerEventId|ownerSubject|longitude|latitude/);
    for (const oldPresentation of ["weather-impact", "hazard-impact"])
      expect(validInTripAnswerPlan({ evidence: [{ evidenceId: e.id, presentation: oldPresentation }] })).toBe(false);
    expect(() => renderInTripAnswer(selection(e.id, "uncertainty"), [e.id], evidence)).toThrow();
    expect(JSON.stringify(snapshot)).toBe(before);
  });
  it("renders external acquisitions separately from saved Impact, including missing Provider evidence", () => {
    for (const output of [{ alerts: hazardInformation() }, { forecast: { status: "unavailable", freshness: "unknown", evidence: [] } }]) {
      const evidence = externalTravelEvidence(output, { retrievedAt: "2026-09-12T08:00:00Z" }), id = evidence[0]!.id;
      const rendered = renderInTripAnswer(selection(id, "external-result"), [id], evidence);
      expect(rendered.text).toContain("保存済みの旅程への影響評価とは別");
      expect(rendered.text).not.toContain("施設が危険");
      expect(() => renderInTripAnswer(selection(id, "environment-impact"), [id], evidence)).toThrow();
      if ("forecast" in output) expect(rendered.text).toContain("最新情報は確認できていません");
    }
  });
  it("rejects model interpretations and unrelated evidence as external result", () => {
    const evidence = externalTravelEvidence({ alerts: hazardInformation() }, { retrievedAt: "2026-09-12T08:00:00Z" });
    const e = evidence[0]!;
    e.knowledgeKind = "model_interpretation";
    expect(() => renderInTripAnswer(selection(e.id, "external-result"), [e.id], evidence)).toThrow();
    const planned = values();
    expect(() => renderInTripAnswer(selection(planned[0]!.id, "external-result"), [planned[0]!.id], planned)).toThrow();
  });
  it("renders saved measurements, not model calculations, and distinguishes boarding from plan", () => {
    const evidence = values(), e = evidence.find((e) => e.coverage?.includes("rail.connection"))!, before = JSON.stringify(evidence);
    const result = renderInTripAnswer(selection(e.id, "rail-impact"), [e.id], evidence);
    for (const expected of ["遅延6分", "見込み4分", "必要5分", "対応が必要", "乗車しているかは確認できていません"]) expect(result.text).toContain(expected);
    expect(result.viewerActions).toEqual([]); expect(result.claims[0]!.evidenceIds).toEqual([e.id]);
    expect(JSON.stringify(evidence)).toBe(before);
  });
  it("renders planned next time in its time zone, without asserting actual location", () => {
    const evidence = values(), e = evidence[0]!;
    expect(renderInTripAnswer(selection(e.id, "planned-itinerary"), [e.id], evidence).text).toMatch(/次の予定.*庭園.*11:00/s);
    expect(renderInTripAnswer(selection(e.id, "planned-itinerary"), [e.id], evidence).text).toContain("実際の現在地や乗車を確認した情報ではありません");
  });
  it("allows explicit saved uncertainty within an otherwise derived Impact without claiming safety", () => {
    const evidence = values(), e = evidence.find((e) => e.coverage?.includes("rail.connection"))!;
    const text = renderInTripAnswer(selection(e.id, "uncertainty"), [e.id], evidence).text;
    expect(text).toContain("接続後の到着見込み"); expect(text).toContain("未確認");
    expect(text).not.toContain("問題ありません");
  });
  it.each(["permission-denied", "not-requested", "unavailable", "available"] as const)("location %s never fabricates location/boarding", (status) => {
    const evidence = values(), e = evidence.find((e) => e.coverage?.includes("location.permission"))!;
    e.facts.status = status;
    expect(renderInTripAnswer(selection(e.id, "location-permission"), [e.id], evidence).text).toContain("現在地や現在乗車中かどうかは確認できません");
  });
  it.each(["source", "coverage", "subset", "missing", "interpretation", "reference"])("rejects incompatible %s reference", (fault) => {
    const evidence = values(), e = evidence[0]!, plan = selection(e.id, "planned-itinerary");
    if (fault === "source") e.references[0]!.sourceType = "model";
    if (fault === "interpretation") e.knowledgeKind = "model_interpretation";
    if (fault === "reference") e.references = [];
    if (fault === "coverage") e.coverage = ["location.permission"];
    if (fault === "missing") plan.evidence[0]!.evidenceId = "does-not-exist";
    expect(() => renderInTripAnswer(plan, fault === "subset" ? [] : [e.id], evidence)).toThrow();
  });
  it.each([
    {}, { evidence: [] }, { evidence: Array.from({ length: 7 }, (_, i) => ({ evidenceId: `id${i}`, presentation: "uncertainty" })) },
    { evidence: [{ evidenceId: "id", presentation: "location-permission", currentLocation: "京都", boarding: true }] },
    { evidence: [{ evidenceId: "id", presentation: "invented" }] },
    { evidence: [{ evidenceId: "id", presentation: "uncertainty" }, { evidenceId: "id", presentation: "uncertainty" }] },
    { evidence: [{ evidenceId: "id", presentation: "uncertainty" }], facts: { delay: 0 } },
  ])("rejects invalid structure or authored facts %j", (plan) => {
    expect(validInTripAnswerPlan(plan)).toBe(false);
    expect(parseAgentDecisionSummary({ interpretedGoal: "回答", hardConstraints: [], softPreferences: [], selectedAction: "answer", unresolvedFacts: [], reasonCodes: [], inTripAnswerPlan: plan })).toBeUndefined();
  });
  it("preserves window/day/unscheduled precision", () => {
    for (const schedule of [{ type: "day", date: "2026-09-13", timeZone: "Asia/Tokyo" }, { type: "window" }, { type: "unscheduled" }]) {
      const evidence = values(), e = evidence[0]!;
      e.facts.next = JSON.stringify([{ itemId: "garden", title: "散策", schedule }]);
      const text = renderInTripAnswer(selection(e.id, "planned-itinerary"), [e.id], evidence).text;
      expect(text).toContain(schedule.type === "day" ? "日付単位" : schedule.type === "window" ? "未確定" : "時刻未設定");
      expect(text).not.toContain("15:00");
    }
  });
});
