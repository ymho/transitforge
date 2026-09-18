import { describe, expect, it, vi } from "vitest";
import { inTripFixture } from "../../../../modules/trip/domain/in-trip-context.fixture";
import { loadInTripContext, withInTripLocation } from "./in-trip-context";
import { buildAgentDecisionContext, agentDecisionContextText } from "@raiquora/agent/agent-decision-context";
describe("in-trip Agent boundary", () => {
  it("loads only in_trip, validates revision and keeps reader failure explicit", async () => {
    const f = inTripFixture(), read = vi.fn(async () => f.snapshot);
    expect(await loadInTripContext({ ...f.trip, lifecycleState: "pre_trip" }, new Date(f.now.at), { read })).toBeUndefined();
    expect(read).not.toHaveBeenCalled();
    expect(await loadInTripContext(f.trip, new Date(f.now.at), { read })).toEqual(f.snapshot);
    read.mockRejectedValue(new Error("PRIVATE"));
    expect((await loadInTripContext(f.trip, new Date(f.now.at), { read }))!.impacts.status).toBe("unavailable");
    read.mockResolvedValue({ ...f.snapshot, trip: { ...f.snapshot.trip, revision: 99 } });
    await expect(loadInTripContext(f.trip, new Date(f.now.at), { read })).rejects.toThrow("旅程が更新");
  });
  it("preserves inTrip through context compression without internal IDs or location inference", () => {
    const f = inTripFixture(), s = withInTripLocation(f.snapshot, { status: "permission-denied" });
    const context = buildAgentDecisionContext({ executionId: "test", feature: "concierge", userRequest: "この後どうしよう",
      context: { inTrip: s, conversation: { messages: Array.from({ length: 30 }, () => ({ role: "assistant" as const, text: "長い履歴".repeat(200) })) } } }, []);
    const serialized = agentDecisionContextText(context), value = JSON.parse(serialized.match(/<agent_context>([\s\S]*)<\/agent_context>/u)![1]!);
    expect(value.inTrip).toEqual(s); expect(serialized).not.toMatch(/bookingReference|episodeId|ownerSubject|dedupeKey/);
  });
});
