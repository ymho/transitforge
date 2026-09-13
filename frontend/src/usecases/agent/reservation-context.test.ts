import { describe, expect, it } from "vitest";
import { reservationContext } from "./reservation-context";
import { reservationFixture } from "../../../../modules/trip/domain/reservation.fixture";
import { reservationFact } from "@raiquora/trip/reservation";
import { buildAgentDecisionContext, agentDecisionContextText } from "./agent-decision-context";
import { runReservationProgressScenario } from "../../adapters/bedrock/reservation-progress-scenarios.fixture";

describe("reservation privacy and model context", () => {
  it("projects only allowed booking facts; unknown is not not-booked", () => {
    const facts = [reservationFact(reservationFixture())];
    const input = reservationContext(facts);
    const context = buildAgentDecisionContext({ executionId: "test", feature: "concierge", userRequest: "相談", context: { reservations: input } }, []);
    expect(context.reservations?.facts[0]?.status).toBe("booked");
    expect(agentDecisionContextText(context)).not.toMatch(/PRIVATE|bookingReference|bookingUrl/);
    expect(reservationContext()).toEqual({ status: "unknown", facts: [], truncated: false });
    expect(reservationContext([])).toEqual({ status: "available", facts: [], truncated: false });
    expect(() => reservationContext([{ ...facts[0]!, bookingReference: "PRIVATE" } as never])).toThrow();
  });
  it("bounds large collections, prioritizes focused booking and preserves the boundary in compact context", () => {
    const facts = Array.from({ length: 80 }, (_, i) => reservationFact(reservationFixture({ id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, itineraryItemId: String(i) })));
    const input = reservationContext(facts, "79");
    expect(input.truncated).toBe(true); expect(input.facts).toHaveLength(24); expect(input.facts[0]?.itineraryItemId).toBe("79");
    const oversized = buildAgentDecisionContext({ executionId: "oversized", feature: "concierge", userRequest: "相談",
      context: { reservations: { status: "available", facts, truncated: false } } }, []);
    expect(oversized.reservations?.truncated).toBe(true);
    expect(oversized.reservations?.facts).toHaveLength(24);
    const context = buildAgentDecisionContext({ executionId: "large", feature: "concierge", userRequest: "相談", context: { reservations: input } }, []);
    context.conversation = { summary: "長い".repeat(14000) };
    // Force the first compact budget without overflowing the minimal request itself.
    context.availableTools = Array.from({ length: 40 }, () => ({ name: "tool", description: "説明".repeat(2000), requiredInputs: [] }));
    context.conversation = undefined;
    const text = agentDecisionContextText(context);
    expect(text).toContain('"reservations"'); expect(text).toContain('"booked"'); expect(text).toContain('"truncated":true');
  });
  it("AB executes production runtime and prevents unconfirmed application", async () => {
    const report = await runReservationProgressScenario({ id: "AB-booked-item", name: "予約", userRequest: "予約済みの予定を短くしたい",
      tags: [], thresholds: { ttfi: 1, selectionToDraft: 1, maximumOrdinaryAskOnlyStreak: 0 } });
    expect(report.failures).toEqual([]);
  });
});
