import { expect, it } from "vitest";
import { buildInTripContext } from "@raiquora/trip/in-trip-context";
import { inTripFixture } from "../../../../modules/trip/domain/in-trip-context.fixture";
import { runViewerAgentRuntime } from "./viewer-agent-runtime";
import { askProgressFixture, modelAnswer, modelTool, modelTools } from "./ask-progress-scenarios.fixture";

it.each(["absent", "host", "focus", "protected"])("initial scope and execution authority are separate: %s", async (mode) => {
  const f = inTripFixture(), trip = { ...structuredClone(f.trip), items: [...structuredClone(f.trip.items)] };
  trip.items[1] = { ...trip.items[1]!, schedule: { type: "window",
    earliestStart: { at: "2026-09-13T11:00:00+09:00", timeZone: "Asia/Tokyo" },
    latestEnd: { at: "2026-09-13T13:00:00+09:00", timeZone: "Asia/Tokyo" } } };
  const before = structuredClone(trip);
  const snapshot = buildInTripContext(trip, f.now, { ...f.facts, tripConfirmed: true, reservations: [] })!;
  let firstContext = "", calls = 0;
  const output = await runViewerAgentRuntime("選択した予定の変更案を見せて", {
    ...askProgressFixture("C-candidate").base, candidateSelection: undefined,
    getCurrentTrip: () => trip, getCurrentDate: () => new Date(f.now.at), getReservationFacts: () => [],
    inTripContextReader: { read: async () => snapshot },
    ...(mode === "host" ? { getReplanTargets: () => ({ tripId: trip.id, baseRevision: trip.revision, itemIds: ["garden"] }) } : {}),
    ...(mode === "focus" ? { getUiFocus: () => ({ itemId: "garden" }) } : {}),
  }, async (messages) => {
    if (!calls++) {
      firstContext = messages.flatMap((m) => m.content.flatMap((b) => "text" in b ? [b.text] : [])).join("\n");
      return modelTools(modelTool("propose_itinerary_removal_or_move", { summary: "取りやめる案", patches: [{ type: "remove", itemId: mode === "protected" ? "rail" : "garden" }] }));
    }
    return modelAnswer('<decision_summary>{"selectedAction":"answer","usedEvidenceIds":["application:in-trip:coverage"],"inTripAnswerPlan":{"evidence":[{"evidenceId":"application:in-trip:coverage","presentation":"uncertainty"}]}}</decision_summary>');
  });
  expect(firstContext.includes('"inTripReplanScope":')).toBe(mode === "host" || mode === "focus");
  const proposal = typeof output !== "string" && "tripUpdateProposal" in output ? output.tripUpdateProposal : undefined;
  if (mode === "protected") expect(proposal).toBeUndefined();
  else expect(proposal?.patches).toContainEqual({ type: "remove", itemId: "garden" });
  expect(trip).toEqual(before);
});
