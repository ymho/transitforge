// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { parsePublicJourneyPresentation } from "@raiquora/agent/public-journey-presentation";
import { renderPublicJourneyPresentation } from "./public-journey-presentation-view";

describe("public journey presentation view", () => {
  it("renders verified stations, trains, transfers and disclosure", () => {
    const value = parsePublicJourneyPresentation({ version: "public-journey-presentation-v1", presentationId: "journey-presentation:test", serviceDate: "2026-09-24", originStation: "京都", destinationStation: "出雲市", evidenceRefs: ["journey:2026-09-24:0"], journeys: [{ id: "journey-1", departureTime: "08:00", arrivalTime: "12:00", durationMinutes: 240, transferCount: 1, legs: [{ originStation: "岡山", destinationStation: "出雲市", departureTime: "09:00", arrivalTime: "12:00", serviceUid: "s1", trainNumber: "1M", serviceType: "特急", trainName: "やくも", serviceDestination: "出雲市" }] }] });
    const root = renderPublicJourneyPresentation(value);
    expect(root.querySelectorAll(".journey-card")).toHaveLength(1);
    expect(root.textContent).toContain("京都 → 出雲市"); expect(root.textContent).toContain("特急 やくも 1M");
    expect(root.textContent).toContain("検証済み検索結果");
  });
});
