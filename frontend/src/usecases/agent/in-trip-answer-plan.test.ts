import { describe, expect, it } from "vitest";
import { inTripFixture } from "../../../../modules/trip/domain/in-trip-context.fixture";
import { inTripApplicationEvidence } from "./in-trip-application-evidence";
import { renderInTripAnswer, validInTripAnswerPlan, type InTripAnswerPlan } from "./in-trip-answer-plan";
import { parseAgentDecisionSummary } from "./agent-decision-summary";

describe("InTripAnswerPlan presentation boundary", () => {
  const values = () => inTripApplicationEvidence(inTripFixture().snapshot);
  const selection = (evidenceId: string, presentation: InTripAnswerPlan["evidence"][number]["presentation"]): InTripAnswerPlan => ({ evidence: [{ evidenceId, presentation }] });
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
