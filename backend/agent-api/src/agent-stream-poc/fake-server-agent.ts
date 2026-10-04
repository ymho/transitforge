import { Model, type BaseModelConfig, type Message, type ModelStreamEvent } from "@strands-agents/sdk";
import { createServerAgent } from "../server-agent-composition.js";
import { StrandsAgentEngine } from "../adapters/strands-agent-engine.js";
import { createStrandsServerRuntime } from "../adapters/strands-server-runtime.js";
import { observeAgentTurn } from "../usecases/agent/observe-agent-turn.js";
import type { ObservedAgentRun } from "./handler.js";

/** Synthetic SDK model for the transport PoC, never used in production. */
class TransportModel extends Model<BaseModelConfig> {
  private config: BaseModelConfig = { modelId: "synthetic-transport" };
  private calls = 0;
  constructor(private readonly counts: { model: number; tool: number }) { super(); }
  updateConfig(config: BaseModelConfig) { this.config = { ...this.config, ...config }; }
  getConfig() { return this.config; }
  async *stream(_messages: Message[]): AsyncGenerator<ModelStreamEvent> {
    this.counts.model++;
    const first = ++this.calls === 1;
    const name = first ? "search_weather_forecast" : "strands_structured_output";
    const input = first ? { location: "京都市" } : { reply: { kind: "uncertainty", text: "天気はまだ確認できません。" } };
    yield { type: "modelMessageStartEvent", role: "assistant" };
    yield { type: "modelContentBlockStartEvent", start: { type: "toolUseStart", name, toolUseId: `transport-${this.calls}` } };
    yield { type: "modelContentBlockDeltaEvent", delta: { type: "toolUseInputDelta", input: JSON.stringify(input) } };
    yield { type: "modelContentBlockStopEvent" };
    yield { type: "modelMessageStopEvent", stopReason: "toolUse" };
  }
}

/** Real Server Application + SDK + weather Usecase; no paid network calls. */
export function fakeServerAgentRun(counts = { model: 0, tool: 0 }): ObservedAgentRun {
  return async (input, emit) => {
    const app = createServerAgent({
      runRuntime: createStrandsServerRuntime(new StrandsAgentEngine({ modelId: "synthetic-transport", region: "test", systemPrompt: "Transport fixture", maxTurns: 4 }, { model: new TransportModel(counts) })),
      weather: { search: async () => { counts.tool++; return { status: "unknown", freshness: "unknown", evidence: [] }; } },
    });
    await observeAgentTurn(app.runAgentTurn, input, emit);
  };
}
