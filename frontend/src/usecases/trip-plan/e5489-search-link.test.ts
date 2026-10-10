import { expect, it } from "vitest";
import { railSelectionFixture } from "../../../../modules/trip/domain/selected-rail-journey.fixture";
import { selectRailJourney } from "@raiquora/trip/selected-rail-journey";
import { e5489SearchLink } from "./e5489-search-link";

it("encodes endpoint names and scheduled departure without the transfer search mode", () => {
  const f = railSelectionFixture(), selected = selectRailJourney(f.candidate, f.inputs, f.selectedAt);
  const journey = { ...selected, legs: selected.legs.map((leg, i) => ({ ...leg,
    origin: { ...leg.origin, name: i === 0 ? "大阪" : "敦賀" },
    destination: { ...leg.destination, name: i === 0 ? "敦賀" : "福井" },
    scheduledDeparture: { ...leg.scheduledDeparture, at: "2026-10-11T07:40:00+09:00" },
  })) };
  const before = structuredClone(journey), url = new URL(e5489SearchLink(journey)!);
  expect(url.origin).toBe("https://e5489.jr-odekake.net");
  expect(Object.fromEntries(url.searchParams)).toEqual({ inputDepartStName: "大阪", inputArriveStName: "福井",
    inputType: "0", inputDate: "20261011", inputHour: "07", inputMinute: "40", inputResultCount: "1",
    inputUniqueDepartSt: "1", inputUniqueArriveSt: "1", SequenceType: "0", inputReturnUrl: "/", encFlag: "1" });
  expect(journey).toEqual(before);
});

it("uses the Tokyo calendar date at midnight rather than UTC or service date", () => {
  const f = railSelectionFixture(), journey = selectRailJourney(f.candidate, f.inputs, f.selectedAt);
  const midnight = { ...journey, legs: [{ ...journey.legs[0]!,
    scheduledDeparture: { at: "2026-10-11T15:00:00Z", timeZone: "Asia/Tokyo" } }] };
  const params = new URL(e5489SearchLink(midnight)!).searchParams;
  expect([params.get("inputDate"), params.get("inputHour"), params.get("inputMinute")]).toEqual(["20261012", "00", "00"]);
  expect(e5489SearchLink({ ...journey, legs: [] })).toBeUndefined();
  expect(e5489SearchLink({ ...journey, legs: [{ ...journey.legs[0]!, scheduledDeparture: { at: "invalid", timeZone: "Asia/Tokyo" } }] })).toBeUndefined();
});
