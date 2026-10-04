import { Model, type BaseModelConfig, type Message, type ModelStreamEvent } from "@strands-agents/sdk";
/** Actual SDK protocol with predetermined synthetic Tool requests. */
export class StrandsScriptedModel extends Model<BaseModelConfig> {
  private config: BaseModelConfig = { modelId: "synthetic-candidate-selection" };
  private cursor = 0;
  constructor(private readonly steps: { name: string; input: unknown }[]) { super(); }
  updateConfig(config: BaseModelConfig) { this.config = { ...this.config, ...config }; }
  getConfig() { return this.config; }
  async *stream(_messages: Message[]): AsyncGenerator<ModelStreamEvent> {
    const step = this.steps[this.cursor++]; if (!step) throw Error("Unexpected additional model call");
    yield { type: "modelMessageStartEvent", role: "assistant" };
    yield { type: "modelContentBlockStartEvent", start: { type: "toolUseStart", name: step.name, toolUseId: `fixture-${this.cursor}` } };
    yield { type: "modelContentBlockDeltaEvent", delta: { type: "toolUseInputDelta", input: JSON.stringify(step.input) } };
    yield { type: "modelContentBlockStopEvent" };
    yield { type: "modelMessageStopEvent", stopReason: "toolUse" };
  }
}
