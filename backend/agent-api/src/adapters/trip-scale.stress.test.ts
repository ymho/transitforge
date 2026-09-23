import { describe, expect, it } from "vitest";
import { applyTripProposal, createTrip, type ItineraryItem } from "@raiquora/trip/trip";
import { tripDynamoFixture } from "./trip-dynamodb.fixture.js";
import { boundedTrip } from "../contracts/trip-api.js";

const owner = { subject: "owner-A" };
const tripId = "11111111-1111-4111-8111-111111111111";

describe("long Trip storage boundaries", () => {
  it("keeps 100 sequential mutations atomic and replays the original immutable receipt", async () => {
    const f = tripDynamoFixture(), initial = longTrip(90);
    f.seed(initial);
    let current = initial;
    const firstMutation = mutation(0, 0);
    for (let index = 0; index < 100; index++) {
      const command = mutation(index, current.revision);
      current = await f.repository.applyMutation(owner, command, value => applyTripProposal(value, command.proposal));
    }
    expect(current.revision).toBe(100);
    const receipts = [...f.records.values()].filter((value) => value.sk?.S?.startsWith("MUTATION#"));
    expect(receipts).toHaveLength(100);
    expect(receipts.every((value) => Buffer.byteLength(value.trip!.S!, "utf8") <= 256 * 1024)).toBe(true);
    const replayed = await f.repository.applyMutation(owner, firstMutation, value => applyTripProposal(value, firstMutation.proposal));
    expect(replayed).toMatchObject({ revision: 1, title: "90日 stress 1" });
    expect((await f.repository.get(owner, tripId))?.revision).toBe(100);
  });

  it("accepts 100 items and rejects 101 without partial persistence", () => {
    expect(boundedTrip(longTrip(100)).items).toHaveLength(100);
    expect(() => boundedTrip(longTrip(101))).toThrow(expect.objectContaining({ code: "payload-too-large" }));
  });
});

function longTrip(count: number) {
  const items: ItineraryItem[] = Array.from({ length: count }, (_, index) => ({ id: `activity-${index + 1}`, title: `観光 ${index + 1}`,
    type: "activity", category: "sightseeing", schedule: { type: "unscheduled" } }));
  return createTrip(tripId, "90日 stress 0", "2026-09-14T00:00:00Z", items);
}
function mutation(index: number, baseRevision: number) {
  const mutationId = `22222222-2222-4222-8222-${String(index + 1).padStart(12, "0")}`;
  return { tripId, baseRevision, mutationId, proposal: { tripId, baseRevision, summary: "title",
    patches: [{ type: "title" as const, title: `90日 stress ${index + 1}` }] } };
}
