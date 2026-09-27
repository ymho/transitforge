import { describe, expect, it } from "vitest";
import { Agent, ModelMessageEvent, AfterToolCallEvent } from "@strands-agents/sdk";
import { parsePartyCohorts } from "@raiquora/trip/party-cohorts";
import { dialogueHistoryFixture, dialogueMessages } from "./strands-dialogue-history.fixture.js";
import { outputSyntaxDiagnostic } from "../adapters/strands-output-syntax.fixture.js";

/** No transcript is logged; actual saved state remains isolated in synthetic
 * owner-scoped repositories. Observe counts/syntax, never mutate SDK events. */
describe.skipIf(process.env.AGENT_V2_LIVE !== "true")("dialogue history with real Nova 2 Lite", () => {
  it("accepts short answers and reversal with persisted conversation history while preserving unrelated conditions", async () => {
    let calls = 0;
    const f = await dialogueHistoryFixture({ createAgent: config => {
      const agent = new Agent(config);
      agent.addHook(ModelMessageEvent, () => { calls++; });
      agent.addHook(AfterToolCallEvent, event => {
        if (event.toolUse.name === "strands_structured_output") console.log(JSON.stringify({ event: "history_output_syntax", sdkStatus: event.result.status, ...outputSyntaxDiagnostic(event.toolUse.input) }));
      });
      return agent;
    } });
    const profileBefore = await f.state.profiles.get(f.principal);
    const whole = { kind: "whole_trip" as const };
    const teen = { count: 1, membership: "baseline" as const, schoolStage: "university" as const, ageDecade: "teens" as const, scope: whole };
    const college = { ...teen, ageDecade: "twenties" as const };
    const expectedRevisions = [2, 3, 4, 5, 5, 6];
    for (let i = 0; i < dialogueMessages.length; i++) {
      const before = await f.overlay(), callbacks = f.writerCallbacks, beforeCalls = calls;
      const result = await f.app.runConversationTurn(f.input(i));
      const overlay = await f.overlay();
      console.log(JSON.stringify({ event: "history_turn", case: i, status: result.status, modelCalls: calls - beforeCalls,
        writerCallbacks: f.writerCallbacks - callbacks, acceptedRevisionDelta: (overlay?.intentRevision ?? 0) - (before?.intentRevision ?? 0) }));
      expect.soft(result.status).toBe("completed");
      expect.soft(result.response.trim().length).toBeGreaterThan(10);
      expect.soft(overlay?.intentRevision, `case ${i} revision`).toBe(expectedRevisions[i]);
      expect.soft(overlay?.facts.find(f => f.target === "party_size")?.value).toEqual({ kind: "quantity", amount: 3, unit: "people" });
      if (i >= 1) expect.soft(overlay?.facts.find(f => f.target === "origin")?.value).toEqual({ kind: "place_label", label: "大阪" });
      if (i === 0) expect.soft(overlay?.facts.find(f => f.target === "party_details")?.value).toEqual({ kind: "party_cohorts", cohorts: parsePartyCohorts([teen, college]) });
      if (i === 1) {
        expect.soft(overlay?.facts.find(f => f.target === "party_details"), "unresolved participant must not change while origin can change").toEqual(before?.facts.find(f => f.target === "party_details"));
        expect.soft(result.response).toContain("出発地：大阪");
        expect.soft(result.response).not.toContain("同行者の詳細：");
      }
      if (i === 2 || i === 3) {
        const scope = { kind: "logical_days" as const, tripId: f.trip.id, tripRevision: 0, dayIds: ["day-a", "day-b"] };
        const expected = i === 2 ? [{ ...teen, scope }, college] : [teen, { ...college, scope }];
        expect.soft(overlay?.facts.find(f => f.target === "party_details")?.value).toEqual({ kind: "party_cohorts", cohorts: parsePartyCohorts(expected) });
        expect.soft(result.response).toContain("1〜2日目");
      }
      if (i === 4) { expect.soft(overlay).toEqual(before); expect.soft(f.writerCallbacks).toBe(callbacks); expect.soft(result.response).not.toContain("反映済み"); }
      if (i === 5) { expect.soft(overlay?.facts.find(f => f.target === "party_details")).toBeUndefined(); expect.soft(result.response).toContain("同行者の詳細：未定"); }
      expect.soft(result.response).not.toContain(f.trip.id);
      const afterCalls = calls;
      expect.soft(await f.app.runConversationTurn(f.input(i))).toEqual(result);
      expect.soft(calls, "B replay must not invoke the model").toBe(afterCalls);
      expect.soft((await f.history()).items.at(-1)?.text).toBe(result.response);
    }
    expect(await f.trips.repository.get(f.principal, f.trip.id)).toEqual(f.trip);
    expect(await f.state.profiles.get(f.principal)).toEqual(profileBefore);
  }, 420000);
});
