import { describe, expect, it } from "vitest";
import { railSelectionFixture } from "./selected-rail-journey.fixture";
import { revalidateSelectedRailJourney, selectRailJourney, validateSelectedRailJourney } from "./selected-rail-journey";

describe("SelectedRailJourney", () => {
  it("adopts only scheduled facts, with source/day/stop identity for every leg", () => {
    const { candidate, inputs, selectedAt } = railSelectionFixture();
    Object.assign(candidate.journey, { status: "delayed", congestion: 9, unknown: "must-not-leak" });
    Object.assign(candidate.journey.legs[0]!, { realtimeStatus: "active", currentPosition: 123, unknown: "must-not-leak" });
    Object.assign(inputs[0]!.evidence, { delayMinutes: 10, raw: { secret: "must-not-leak" } });
    const before = structuredClone({ candidate, inputs });
    const snapshot = selectRailJourney(candidate, inputs, selectedAt);
    expect(snapshot.legs[0]!.scheduledDeparture).toEqual({ at: "2026-09-13T00:00:00.000Z", timeZone: "Asia/Tokyo" }); // 09:00 JST, not 09:10
    expect(snapshot.legs[1]!.scheduledArrival.at).toBe("2026-09-13T01:40:00.000Z");
    expect(snapshot.transfers).toEqual([{ fromLegId: "leg-1", toLegId: "leg-2", minimumTransferMinutes: 5 }]);
    expect(snapshot.provenance.timetableInputs).toHaveLength(2);
    for (const field of ["delayMinutes", "delayStatus", "status", "congestion", "currentPosition", "unknown", "must-not-leak"]) expect(JSON.stringify(snapshot)).not.toContain(field);
    expect({ candidate, inputs }).toEqual(before);
    expect(revalidateSelectedRailJourney(snapshot, inputs)).toBe(true);
  });

  it.each([
    "no-provenance", "no-digest", "wrong-day", "wrong-number", "wrong-uid", "duplicate-service", "missing-stop",
    "wrong-stop", "missing-scheduled", "corrected-as-scheduled", "future-verification", "invalid-date", "wrong-evidence-kind",
  ])("rejects unverifiable candidate: %s", (condition) => {
    const { candidate, inputs, selectedAt } = railSelectionFixture();
    switch (condition) {
      case "no-provenance": candidate.verifiedJourneyRef = ""; break;
      case "wrong-evidence-kind": inputs[0]!.evidence.kind = "weather"; break;
      case "no-digest": inputs[0]!.contentDigest = ""; break;
      case "wrong-day": inputs[0]!.index.service_date = "2026-09-14"; break;
      case "wrong-number": candidate.journey.legs[0]!.trainNumber = "2M"; break;
      case "wrong-uid": candidate.journey.legs[0]!.serviceUid = "missing"; break;
      case "duplicate-service": inputs[0]!.index.trains.push(structuredClone(inputs[0]!.index.trains[0]!)); break;
      case "missing-stop": inputs[0]!.index.trains[0]!.stops = []; break;
      case "wrong-stop": candidate.legReferences = [{ ...candidate.legReferences[0]!, originStopIndex: 1 }, candidate.legReferences[1]!]; break;
      case "missing-scheduled": delete candidate.journey.legs[0]!.scheduledDepartureTimeMinutes; break;
      case "corrected-as-scheduled": candidate.journey.legs[0]!.scheduledDepartureTimeMinutes = 550; break;
      case "future-verification": candidate.verifiedAt = "2026-09-14T00:00:00Z"; break;
      case "invalid-date": candidate.legReferences = candidate.legReferences.map((ref) => ({ ...ref, serviceDate: "2026-02-30" })); inputs[0]!.index.service_date = "2026-02-30"; break;
    }
    expect(() => selectRailJourney(candidate, inputs, selectedAt)).toThrow();
  });

  it("rejects a connection which is possible only due to delay", () => {
    const { candidate, inputs, selectedAt } = railSelectionFixture();
    inputs[0]!.index.trains[1]!.stops[0]!.route_time_minutes = 602;
    candidate.journey.legs[1]!.scheduledDepartureTimeMinutes = 602;
    // Actual 610 -> 620 is feasible, scheduled 600 -> 602 is not.
    expect(() => selectRailJourney(candidate, inputs, selectedAt)).toThrow(/Transfer/);
  });

  it("preserves >24h minutes and different service days across a transfer", () => {
    const { candidate, inputs, selectedAt } = railSelectionFixture();
    const second = structuredClone(inputs[0]!);
    second.index.service_date = "2026-09-14";
    second.contentDigest = "sha256:fixture-b";
    candidate.legReferences = [candidate.legReferences[0]!, { ...candidate.legReferences[1]!, serviceDate: "2026-09-14", contentDigest: second.contentDigest }];
    inputs[0]!.index.trains[0]!.stops[0]!.route_time_minutes = 1_430;
    inputs[0]!.index.trains[0]!.stops[1]!.route_time_minutes = 1_460;
    candidate.journey.legs[0]!.scheduledDepartureTimeMinutes = 1_430;
    candidate.journey.legs[0]!.scheduledArrivalTimeMinutes = 1_460;
    const snapshot = selectRailJourney(candidate, [...inputs, second], selectedAt);
    expect(snapshot.legs[0]!.scheduledArrival.at).toBe("2026-09-13T15:20:00.000Z"); // Sep14 00:20 JST
    expect(snapshot.legs[1]!.serviceDate).toBe("2026-09-14");
    expect(revalidateSelectedRailJourney(snapshot, [...inputs, second])).toBe(true);
  });

  it("does not match a different visit to the same station by name or train number", () => {
    const { candidate, inputs, selectedAt } = railSelectionFixture();
    inputs[0]!.index.trains[0]!.stops.push({ station_name: "A", event: "発", route_time_minutes: 650 }, { station_name: "B", event: "着", route_time_minutes: 700 });
    candidate.legReferences = [{ ...candidate.legReferences[0]!, originStopIndex: 2, destinationStopIndex: 3 }, candidate.legReferences[1]!];
    expect(() => selectRailJourney(candidate, inputs, selectedAt)).toThrow(/scheduled/);
  });

  it.each(["digest", "policy", "missing", "schedule", "transfer-rule"])("revalidation detects %s without mutating the snapshot", (change) => {
    const { candidate, inputs, selectedAt } = railSelectionFixture();
    const snapshot = selectRailJourney(candidate, inputs, selectedAt);
    if (change === "policy") Object.assign(snapshot.provenance, { validationPolicyVersion: "old-policy" });
    const before = structuredClone(snapshot);
    if (change === "digest") inputs[0]!.contentDigest = "new-digest";
    if (change === "schedule") inputs[0]!.index.trains[0]!.stops[0]!.route_time_minutes = 541;
    if (change === "transfer-rule") inputs[0]!.defaultTransferMinutes = 11;
    expect(revalidateSelectedRailJourney(snapshot, change === "missing" ? [] : inputs)).toBe(false);
    expect(snapshot).toEqual(before);
  });

  it("rejects extra fields at the future storage/patch validation boundary too", () => {
    const { candidate, inputs, selectedAt } = railSelectionFixture();
    const snapshot = selectRailJourney(candidate, inputs, selectedAt);
    Object.assign(snapshot.legs[0]!, { delayMinutes: 10 });
    expect(() => validateSelectedRailJourney(snapshot)).toThrow(/Unknown field/);
  });
});
