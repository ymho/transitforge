import { expect, it } from "vitest";
import { createTrip, applyTripProposal } from "./trip";
import { proposeReviewedRequestChanges, type ReviewedRequestChange } from "./reviewed-request-changes";
import { proposeModelRequest } from "./model-request-proposal";

const trip = createTrip("11111111-1111-4111-8111-111111111111", "秋の旅行", "2026-09-01T00:00:00Z", [
  { id: "walk", type: "activity", category: "free-time", title: "散策", schedule: { type: "day", date: "2026-10-01" } },
], { goal: "街歩き", party: { source: "user", adults: 2, children: [{}] }, constraints: [
  { id: "dates", source: "user", strength: "hard", scope: { type: "trip" }, requirement: { type: "dates", start: { earliest: "2026-10-01", latest: "2026-10-01" } } },
  { id: "pace", source: "profile", strength: "soft", scope: { type: "trip" }, requirement: { type: "pace", value: 0.4 }, assumptionId: "profile-pace" },
], assumptions: [{ id: "profile-pace", text: "普段のペース", source: "profile", status: "confirmed", affects: [{ type: "constraint", constraintId: "pace" }] }] });
const dateChange: ReviewedRequestChange = { type: "replace_constraint", constraintId: "dates", strength: "hard", reason: "日程を遅らせる案",
  requirement: { type: "dates", start: { earliest: "2026-10-10", latest: "2026-10-12" } } };
function propose(changes: ReviewedRequestChange[]) {
  let i = 0; return proposeReviewedRequestChanges(trip, changes, () => `new-${++i}`);
}
it("keeps dates flexible, unrelated conditions intact, and schedules unchanged until and after review", () => {
  const original = structuredClone(trip), proposal = propose([dateChange]);
  expect(trip).toEqual(original); expect(proposal).toMatchObject({ tripId: trip.id, baseRevision: 0 });
  const next = applyTripProposal(trip, proposal);
  expect(next.items).toEqual(trip.items); expect(next.request.party).toEqual(trip.request.party);
  expect(next.request.constraints[1]).toEqual(trip.request.constraints[1]);
  expect(next.request.constraints[0]).toMatchObject({ source: "assumption", assumptionId: "new-1", requirement: dateChange.requirement });
  expect(next.request.assumptions.at(-1)).toMatchObject({ source: "model", status: "unconfirmed", affects: [{ type: "constraint", constraintId: "dates" }] });
  expect(() => applyTripProposal({ ...trip, revision: 1 }, proposal)).toThrow();
});
it("groups party, goal and constraint removals into one atomic request patch", () => {
  const next = applyTripProposal(trip, propose([
    { type: "set_party", party: { adults: 3, children: [{}] }, reason: "同行者を追加する案" },
    { type: "set_goal", goal: "美術館めぐり", reason: "目的を変更する案" },
    { type: "remove_constraint", constraintId: "pace", reason: "ペースを解除する案" },
  ]));
  expect(next.request.party).toMatchObject({ adults: 3, children: [{}], source: "assumption", assumptionId: "new-1" });
  expect(next.request.goal).toBe("美術館めぐり"); expect(next.request.constraints.map(c => c.id)).toEqual(["dates"]);
  expect(next.request.assumptions[0]).toEqual({ ...trip.request.assumptions[0], affects: [] });
  expect(next.items).toEqual(trip.items);
});
it("clears optional values without inventing zero counts or confirming/rejecting old hypotheses", () => {
  const next = applyTripProposal(trip, propose([{ type: "clear_party", reason: "人数未定" }, { type: "clear_goal", reason: "目的未定" }]));
  expect(next.request.party).toBeUndefined(); expect(next.request.goal).toBeUndefined();
  expect(next.request.assumptions).toEqual(trip.request.assumptions);
});
it.each([
  [{ ...dateChange, constraintId: "foreign" }], [dateChange, dateChange],
  [{ ...dateChange, requirement: { type: "pace", value: 0.5 } }],
  [{ ...dateChange, requirement: { type: "dates", start: { earliest: "2026-10-12", latest: "2026-10-10" } } }],
  [{ ...dateChange, actor: "user" }], [{ ...dateChange, strength: "guessed" }],
  [{ type: "set_party", reason: "人数", party: { adults: 1, children: [], source: "user" } }],
  [{ type: "set_party", reason: "人数", party: { adults: 0, children: [] } }],
  [{ type: "set_goal", goal: "変更", reason: "" }],
].map(changes => ({ changes })))("rejects invalid edits atomically", ({ changes }) => {
  const original = structuredClone(trip);
  expect(() => propose(changes as ReviewedRequestChange[])).toThrow(); expect(trip).toEqual(original);
});
it("does not weaken the append-only assumptions tool", () => {
  const changed = applyTripProposal(trip, propose([dateChange]));
  expect(() => proposeModelRequest(trip, changed.request)).toThrow("Model cannot rewrite existing constraints");
});
it("rejects new provider facts in an origin replacement", () => {
  const withOrigin = createTrip(trip.id, trip.title, trip.createdAt, [], { constraints: [{ id: "origin", source: "user", strength: "hard", scope: { type: "trip" }, requirement: { type: "origin", place: { name: "京都", sources: [] } } }], assumptions: [] });
  expect(() => proposeReviewedRequestChanges(withOrigin, [{ type: "replace_constraint", constraintId: "origin", strength: "hard", reason: "起点変更", requirement: { type: "origin", place: { name: "大阪", coordinates: { latitude: 34, longitude: 135 }, sources: [] } } } as unknown as ReviewedRequestChange], () => "a")).toThrow();
});
it("does not demote unchanged known values into model hypotheses", () => {
  expect(() => propose([{ type: "set_party", party: { adults: 2, children: [{}] }, reason: "同じ人数" }])).toThrow("Party has not changed");
  expect(() => propose([{ type: "set_goal", goal: "街歩き", reason: "同じ目的" }])).toThrow("Goal has not changed");
  expect(() => propose([{ ...dateChange, requirement: trip.request.constraints[0].requirement }])).toThrow("Condition has not changed");
});
