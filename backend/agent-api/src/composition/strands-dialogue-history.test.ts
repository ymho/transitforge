import { expect, it } from "vitest";
import { Model, type BaseModelConfig, type Message, type ModelStreamEvent } from "@strands-agents/sdk";
import { parsePartyCohorts } from "@raiquora/trip/party-cohorts";
import { dialogueHistoryFixture, dialogueMessages } from "./strands-dialogue-history.fixture.js";

const whole = { kind: "whole_trip" }, untilTwo = { kind: "logical_days", fromDay: 1, toDay: 2 };
const teen = { count: 1, membership: "baseline", schoolStage: "university", ageDecade: "teens", scope: whole };
const college = { ...teen, ageDecade: "twenties" };
type Step = { name: string; input: unknown };
const say = (text: string): Step => ({ name: "strands_structured_output", input: { reply: { kind: "conversation", message: "acknowledgement", text } } });
const update = (index: number, finalCohorts: unknown): Step => ({ name: "update_current_party_details", input: { finalCohorts, quote: dialogueMessages[index] } });
class DialogueModel extends Model<BaseModelConfig> {
  calls = 0;
  readonly messages: Message[][] = [];
  private config: BaseModelConfig = { modelId: "scripted-dialogue" };
  private readonly steps: Step[] = [
    { name: "update_current_party", input: { action: "set", party: { kind: "count", people: 3 }, quote: "全体で3人です。" } },
    update(0, [teen, college]), say("大学生のお二人の条件を受け取りました。"),
    { name: "update_current_origin", input: { action: "set", place: "大阪", quote: "出発地は大阪にします。" } },
    { name: "strands_structured_output", input: { reply: { kind: "clarification", target: "participation_scope", text: "途中で帰る方はまだ未定ですね。決まったら10代か20代かを教えてください。同行者条件は保留にします。" } } },
    update(2, [{ ...teen, scope: untilTwo }, college]), say("10代の大学生の方ですね。参加範囲を反映しました。"),
    update(3, [teen, { ...college, scope: untilTwo }]), say("逆でしたね。20代の方が2日目まで参加する条件に訂正しました。"),
    { name: "consider_trip_scenario", input: { kind: "party_details", cohorts: [teen, college], quote: dialogueMessages[4] } },
    { name: "strands_structured_output", input: { reply: { kind: "uncertainty", text: "全行程参加できる仮定で検討できます。費用や空室はまだ確認していません。現在の条件は変更していません。" } } },
    update(5, null), say("同行者の詳細だけを未定に戻しました。"),
  ];
  updateConfig(config: BaseModelConfig) { this.config = { ...this.config, ...config }; }
  getConfig() { return this.config; }
  async *stream(messages: Message[]): AsyncGenerator<ModelStreamEvent> {
    this.messages.push(structuredClone(messages));
    const step = this.steps[this.calls++];
    if (!step) throw new Error("Unexpected extra model call");
    yield { type: "modelMessageStartEvent", role: "assistant" };
    yield { type: "modelContentBlockStartEvent", start: { type: "toolUseStart", name: step.name, toolUseId: `history-${this.calls}` } };
    yield { type: "modelContentBlockDeltaEvent", delta: { type: "toolUseInputDelta", input: JSON.stringify(step.input) } };
    yield { type: "modelContentBlockStopEvent" };
    yield { type: "modelMessageStopEvent", stopReason: "toolUse" };
  }
}

it("loads real persisted history for short corrections, exposes accepted conditions, and replays the identical public turn", async () => {
  const model = new DialogueModel(), f = await dialogueHistoryFixture({ model });
  const profileBefore = await f.state.profiles.get(f.principal);
  const expectedRevisions = [2, 3, 4, 5, 5, 6];
  for (let i = 0; i < dialogueMessages.length; i++) {
    const before = await f.overlay(), callbacks = f.writerCallbacks, firstCall = model.calls;
    const result = await f.app.runConversationTurn(f.input(i));
    expect(result.status).toBe("completed");
    const overlay = await f.overlay();
    expect(overlay?.intentRevision).toBe(expectedRevisions[i]);
    expect(overlay?.facts.find(f => f.target === "party_size")?.value).toEqual({ kind: "quantity", amount: 3, unit: "people" });
    if (i >= 1) expect(overlay?.facts.find(f => f.target === "origin")?.value).toEqual({ kind: "place_label", label: "大阪" });
    if (i === 1) {
      expect(overlay?.facts.find(f => f.target === "party_details")).toEqual(before?.facts.find(f => f.target === "party_details"));
      expect(result.response).toContain("決まったら10代か20代か");
      expect(result.response).toContain("出発地：大阪");
      expect(result.response).not.toContain("同行者の詳細：");
    }
    if (i === 2 || i === 3) {
      const resolvedScope = { kind: "logical_days", tripId: f.trip.id, tripRevision: 0, dayIds: ["day-a", "day-b"] };
      const expected = i === 2 ? [{ ...teen, scope: resolvedScope }, college] : [teen, { ...college, scope: resolvedScope }];
      expect(overlay?.facts.find(f => f.target === "party_details")?.value).toEqual({ kind: "party_cohorts", cohorts: parsePartyCohorts(expected) });
      expect(result.response).toContain("今回の相談条件（反映済み）");
      expect(result.response).toContain("1〜2日目");
      const input = JSON.parse((model.messages[firstCall]![0]!.content[0] as { text: string }).text);
      expect(input.application.conversation.messages).toHaveLength(i * 2);
      expect(input.application.conversation.messages.at(-1).role).toBe("assistant");
      expect(input.application.conversation.messages.at(-2).text).toBe(dialogueMessages[i - 1]);
      expect(input.userMessage).toBe(dialogueMessages[i]);
    }
    if (i === 4) { expect(overlay).toEqual(before); expect(f.writerCallbacks).toBe(callbacks); expect(result.response).not.toContain("反映済み"); }
    if (i === 5) { expect(overlay?.facts.find(f => f.target === "party_details")).toBeUndefined(); expect(result.response).toContain("同行者の詳細：未定"); }
    expect(result.response).not.toContain(f.trip.id);
    expect(result.response).not.toContain("day-a");
    const calls = model.calls;
    expect(await f.app.runConversationTurn(f.input(i))).toEqual(result);
    expect(model.calls).toBe(calls);
    expect((await f.history()).items.at(-1)?.text).toBe(result.response);
  }
  expect(await f.trips.repository.get(f.principal, f.trip.id)).toEqual(f.trip);
  expect(await f.state.profiles.get(f.principal)).toEqual(profileBefore);
});
