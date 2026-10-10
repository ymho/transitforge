import { describe, expect, it } from "vitest";
import { createTrip, validateTrip, applyTripProposal } from "./trip";
import { officialGuideSnapshot, importOfficialGuide, validateOfficialGuide } from "./official-guide";
const id = "11111111-1111-4111-8111-111111111111", copyId = "22222222-2222-4222-8222-222222222222", at = "2026-09-14T02:00:00.000Z";
const source = () => createTrip(id, "海辺の2日間", at, [
  { id: "a", type: "activity", title: "海を歩く", category: "sightseeing", schedule: { type: "relative", dayId: "d1" }, logicalDayId: "d1" },
  { id: "s", type: "stay", title: "個人の宿泊先", selection: { status: "unselected", place: { name: "個人の宿泊先", sources: [] } }, schedule: { type: "relative", dayId: "d1" }, logicalDayId: "d1" },
  { id: "b", type: "activity", title: "市場", category: "food", schedule: { type: "relative", dayId: "d2" }, logicalDayId: "d2" },
], { constraints: [], assumptions: [], party: { source: "user", adults: 2, children: [] } }, "itinerary_draft", "海辺", { version: 1,
  logicalDays: [{ id: "d1", label: "1日目" }, { id: "d2", label: "2日目" }], calendarBindings: [{ logicalDayId: "d1", date: "2026-09-20", timeZone: "Asia/Tokyo", basis: "explicit" }] });
describe("official guide independent snapshot", () => {
  it("removes dates, party, private stay choices, decisions and confirmation", () => {
    const original = source(), snapshot = officialGuideSnapshot(original);
    expect(snapshot.request).toEqual({ constraints: [], assumptions: [] }); expect(snapshot.timeline?.calendarBindings).toEqual([]);
    expect(snapshot.items[1]).toMatchObject({ title: "宿泊先を選ぶ", selection: { status: "unselected" } });
    expect(JSON.stringify(snapshot)).not.toMatch(/個人の宿泊先|2026-09-20/);
    expect(original.items[1]?.title).toBe("個人の宿泊先");
  });
  it("copies with user dates/party and retains origin through edits without changing the guide", () => {
    const guide = { id, version: 3, publishedAt: at, trip: officialGuideSnapshot(source()) };
    validateOfficialGuide(guide);
    const copied = importOfficialGuide(guide, copyId, at, "2026-12-31", 3, 1); validateTrip(copied);
    expect(copied.timeline?.calendarBindings.map(d => d.date)).toEqual(["2026-12-31", "2027-01-01"]);
    expect(copied.request.party).toEqual({ source: "user", adults: 3, children: [{}] });
    const edited = applyTripProposal(copied, { tripId: copyId, baseRevision: 0, summary: "名前変更", patches: [{ type: "title", title: "私の旅" }] });
    expect(edited.officialOrigin).toEqual({ guideId: id, version: 3 }); expect(guide.trip.title).toBe("海辺の2日間");
  });
  it.each([["2026-02-30", 1, 0], ["2026-10-10", 0, 0], ["2026-10-10", 1, -1], ["2026-10-10", 1.5, 0]])("rejects invalid import input", (date, adults, children) => {
    expect(() => importOfficialGuide({ id, version: 1, publishedAt: at, trip: source() }, copyId, at, String(date), Number(adults), Number(children))).toThrow();
  });
  it("rejects malformed official metadata", () => {
    for (const override of [{ version: 0 }, { id: copyId }, { publishedAt: "invalid" }, { publisher: "private" }])
      expect(() => validateOfficialGuide({ id, version: 1, publishedAt: at, trip: source(), ...override })).toThrow();
  });
});
