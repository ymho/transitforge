import { createServerAgent } from "../server-agent-composition.js";
import { observeAgentTurn } from "../usecases/agent/observe-agent-turn.js";
import type { ObservedAgentRun } from "./handler.js";

/** Real Server Application + weather Usecase, fake model/Provider. No paid network calls. */
export function fakeServerAgentRun(counts = { model: 0, tool: 0 }): ObservedAgentRun {
  return async (input, emit) => {
    let calls = 0;
    const app = createServerAgent({
      model: { converse: async () => {
        counts.model++;
        return ++calls === 1
          ? { stopReason: "tool_use", metadata: { modelId: "fake", latencyMs: 0 }, message: { role: "assistant", content: [
            { toolUse: { toolUseId: "weather-1", name: "search_weather_forecast", input: { location: "京都市" } } },
          ] } }
          : { stopReason: "end_turn", metadata: { modelId: "fake", latencyMs: 0 }, message: { role: "assistant", content: [{ text:
            '<decision_summary>{"interpretedGoal":"天気確認","hardConstraints":[],"softPreferences":[],"selectedAction":"answer","unresolvedFacts":[],"reasonCodes":["information_missing"],"usedEvidenceIds":["application:external-result:weather"]}</decision_summary>取得結果を案内します。' }] } };
      } },
      weather: { search: async () => { counts.tool++; return { status: "unknown", freshness: "unknown", evidence: [] }; } },
    });
    await observeAgentTurn(app.runAgentTurn, input, emit);
  };
}
