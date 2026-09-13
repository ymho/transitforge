// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { assessTravelCandidate } from "@raiquora/trip/assess-travel-candidate";
import { candidateAssessmentFixture, assessmentAt, assessedInformation, assessmentSource } from "../../../../modules/trip/domain/candidate-assessment.fixture";
import { resolvedPlace } from "../../../../modules/trip/domain/trip-places.fixture";
import { createTripWorkspaceController } from "../../usecases/trip-plan/trip-workspace-controller";
import { renderWorkspaceCandidates } from "./trip-workspace-candidates";

describe("candidate assessment cards", () => {
  it.each(["favorable", "unavailable", "violation", "unknown", "hazard", "currency"])("renders %s without adopting or claiming whole-trip coverage", (kind) => {
    const f = candidateAssessmentFixture();
    if (kind === "unavailable") f.facts.weather!.result = { status: "unavailable", freshness: "unknown", evidence: [] };
    if (kind === "violation") { const other = resolvedPlace("Vienna", "other-region"); f.facts.places = assessedInformation({ destinations: [other], complete: true }, other.sources); }
    if (kind === "unknown") delete f.facts.places;
    if (kind === "hazard") f.facts.hazard = { place: f.destination.ref!, result: assessedInformation({ area: "Vienna", alerts: [
      { providerAlertId: "alert", category: "warning", severity: "warning", title: "架空警報", summary: "注意", issuedAt: "2026-09-12T07:50:00Z", sourceUrl: "https://example.com/alert" },
    ] }, [assessmentSource("alert", "safety-alert")]) };
    if (kind === "currency") {
      const second = { ...f.candidate.accommodations[0]!, providerItemId: "second", price: { price: { currency: "JPY" as const, amountMinor: 20000 }, observedAt: "2026-09-12T07:54:00Z" } };
      f.candidate.accommodations = [...f.candidate.accommodations, second]; f.facts.prices!.data!.items.push({ provider: "fixture", providerItemId: "second", observation: second.price });
      f.facts.prices!.evidence.push(assessmentSource("second-price", "accommodation", "fixture", "second"));
    }
    const assessment = assessTravelCandidate(f.trip, f.candidate, f.facts, assessmentAt), before = structuredClone(f.trip);
    const controller = createTripWorkspaceController("s"); controller.attach("s", { getCurrentTrip: () => f.trip, getCandidates: () => [{ candidate: f.candidate, assessment }] });
    const card = renderWorkspaceCandidates(controller, vi.fn());
    expect(card.textContent).toContain("一部地点の予報"); expect(card.textContent).toContain("city-vienna"); expect(card.textContent).toContain("2026-09-13");
    expect(card.textContent).toContain({ favorable: "比較上は良好", unavailable: "取得できません", violation: "1件不一致", unknown: "1件未確認", hazard: "警報・注意情報あり", currency: "異通貨のため総額比較不可" }[kind]!);
    expect(card.textContent).toContain("一部の情報だけ"); expect(f.trip).toEqual(before); expect(f.trip.items).toEqual([]);
  });
});
