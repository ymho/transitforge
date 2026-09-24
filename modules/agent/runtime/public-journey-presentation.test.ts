import { describe, expect, it } from "vitest";
import { parsePublicJourneyPresentation, projectPublicJourneyPresentation } from "./public-journey-presentation";

const result = { serviceDate: "2026-09-24", originStation: "京都", destinationStation: "出雲市", searchTimeMinutes: 480, totalMatchCount: 1, matches: [], journeys: [{ departureTimeMinutes: 480, arrivalTimeMinutes: 720, transferCount: 1, legs: [{ serviceUid: "s1", trainNumber: "1M", serviceType: "特急", trainName: "やくも", serviceDestination: "出雲市", originStation: "岡山", destinationStation: "出雲市", departureTimeMinutes: 540, arrivalTimeMinutes: 720, scheduledDepartureTimeMinutes: 540, scheduledArrivalTimeMinutes: 720, delayMinutes: 0 }] }] };
describe("public journey presentation", () => {
  it("projects only selected verified journeys", () => expect(projectPublicJourneyPresentation(result, new Set(["journey:2026-09-24:0"]))).toMatchObject({ journeys: [{ departureTime: "08:00", legs: [{ trainName: "やくも" }] }] }));
  it("rejects unknown browser fields", () => expect(() => parsePublicJourneyPresentation({ ...projectPublicJourneyPresentation(result), rawToolOutput: {} })).toThrow());
});
