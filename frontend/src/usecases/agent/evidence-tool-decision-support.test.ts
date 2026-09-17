import { expect, it } from "vitest";
import { inTripFixture } from "../../../../modules/trip/domain/in-trip-context.fixture";
import { inTripApplicationEvidence } from "./in-trip-application-evidence";
import { evidenceAwareTool } from "./evidence-tool-decision-support";
import { viewerAgentToolDescriptors } from "../../adapters/bedrock/viewer-agent-runtime";

it("keeps every Tool and schema; describes covered scope without turning it into permission", () => {
  const evidence = inTripApplicationEvidence(inTripFixture().snapshot), tools = viewerAgentToolDescriptors();
  const before = JSON.stringify(tools), adapted = tools.map((t) => evidenceAwareTool(t, evidence));
  expect(adapted.map((t) => t.name)).toEqual(tools.map((t) => t.name));
  expect(adapted.map((t) => t.inputSchema)).toEqual(tools.map((t) => t.inputSchema));
  expect(JSON.stringify(tools)).toBe(before);
  const rail = adapted.find((t) => t.name === "search_direct_routes")!.description;
  expect(rail).toContain("rail.connection"); expect(rail).toContain("新しい代替案"); expect(rail).toContain("Tool禁止ではない");
  const ask = adapted.find((t) => t.name === "ask_follow_up")!.description;
  expect(ask).toContain("利用者にしか決められない条件ではない");
});
it("does not claim stale/unknown coverage is fresh and leaves absent scope unchanged", () => {
  const evidence = inTripApplicationEvidence(inTripFixture().snapshot);
  const weather = viewerAgentToolDescriptors(["search_weather_forecast"])[0]!;
  expect(evidenceAwareTool(weather, evidence)).toEqual(weather);
  evidence[1]!.coverage = ["weather.impact", "hazard.impact"];
  evidence[1]!.references[0]!.freshness = "unknown";
  expect(evidenceAwareTool(weather, evidence).description).toContain("(unknown)");
  expect(evidenceAwareTool(weather, evidence).description).toContain("最新確認が必要");
});
