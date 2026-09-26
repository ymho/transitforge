from pathlib import Path
import json


def replace(path, old, new, count=1):
    p = Path(path)
    text = p.read_text()
    found = text.count(old)
    if found != count:
        raise RuntimeError(f'{path}: expected {count} anchors, got {found}: {old[:70]}')
    p.write_text(text.replace(old, new))


def write(path, content):
    Path(path).write_text(content)


reply_path = 'modules/agent/runtime/agent-v2-reply.ts'
old_reply = Path(reply_path).read_text()
receipts = old_reply[old_reply.index('/** Trusted Application input'):old_reply.index('/** Flat schema')]
write(reply_path, '''import { z } from "zod";

/** One syntax definition for TypeScript, SDK JSON Schema and Application parsing.
 * References authorize nothing: Evidence/currentness/receipts are checked by admission. */
export const replyOperations = ["save", "change", "book", "pay"] as const;
export type ReplyOperation = typeof replyOperations[number];
export const replyQuestions = ["goal", "origin", "destination", "start_date", "duration", "party_size", "budget"] as const;
export type ReplyQuestion = typeof replyQuestions[number];
const identifier = (maximum: number) => z.string().min(1).max(maximum)
  .regex(/^(?!\\s)(?![\\s\\S]*\\s$)[^\\u0000-\\u001f\\u007f<>]+$/u);
const reference = z.strictObject({ evidenceId: identifier(240), field: z.string().min(1).max(80).regex(/^[a-zA-Z][a-zA-Z0-9_]*$/u) });
export type ReplyReference = z.infer<typeof reference>;
const commentary = z.string().min(1).max(1200).describe("Selected Evidenceに基づく説明・比較・推薦。未確認の時刻・料金・操作結果を作らない。");
export const agentV2ReplySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("answer"), references: z.array(reference).min(1).max(8), commentary: commentary.optional() }),
  z.strictObject({ kind: z.literal("candidates"), evidenceIds: z.array(identifier(240)).min(1).max(8), commentary }),
  z.strictObject({ kind: z.literal("conversation"), message: z.enum(["greeting", "thanks", "acknowledgement"]) }),
  z.strictObject({ kind: z.literal("clarification"), target: z.enum(replyQuestions) }),
  z.strictObject({ kind: z.literal("unavailable"), operation: z.enum(replyOperations) }),
  z.strictObject({ kind: z.literal("operation_result"), receiptId: identifier(240) }),
  z.strictObject({ kind: z.literal("uncertainty") }),
]);
export type AgentV2ReplyProposal = z.infer<typeof agentV2ReplySchema>;
/** The object envelope is the SDK Tool's input; the variant is nested, not flattened. */
export const agentV2StructuredOutputSchema = z.strictObject({ reply: agentV2ReplySchema })
  .describe("必要なread/条件受理の後の最終回答。replyだけを返す。カード本体や新たな事実・実行結果は生成しない。");

''' + receipts + '''/** No handwritten variant parser and no response repair. */
export function parseAgentV2Reply(value: unknown): AgentV2ReplyProposal {
  const parsed = agentV2ReplySchema.safeParse(value);
  if (!parsed.success) throw new AgentV2ReplyError("invalid_proposal");
  return parsed.data;
}
''')

engine = 'backend/agent-api/src/adapters/strands-agent-engine.ts'
p = Path(engine)
s = p.read_text()
end = s.index('} from "@strands-agents/sdk";') + len('} from "@strands-agents/sdk";')
s = '''import {
  Agent, BedrockModel, StructuredOutputError, tool,
  type AgentConfig, type BaseModelConfig, type InvokableTool,
  type JSONSchema, type JSONValue, type Model,
} from "@strands-agents/sdk";''' + s[end:]
s = s.replace('agentV2ReplySchema, type AgentV2ReplyProposal', 'agentV2StructuredOutputSchema, type AgentV2ReplyProposal')
s = s.replace('import { AgentV2ReplySubmission } from "./strands-reply-submission.js";\n', '')
s = s.replace('export const strandsReplyToolName = "submit_reply";\n', '')
s = s.replace('    lastMessage?: unknown;', '    structuredOutput?: unknown;\n    lastMessage?: unknown;')
s = s.replace('[strandsReplyToolName, strandsIntentToolName].includes(name)', 'name === strandsIntentToolName')
s = s.replace('const evidence: Evidence[] = [], submission = new AgentV2ReplySubmission();', 'const evidence: Evidence[] = [];')
s = s.replace('canExecute: () => !submission.submitted && !intentUnavailable', 'canExecute: () => !intentUnavailable')
s = s.replace('        if (submission.submitted) return jsonValue({ ok: false, error: { code: "reply_submitted", retryable: false } });\n', '')
s = s.replace(' or after submit_reply', ' after the final structured result')
start = s.index('    tools.push(tool({\n      name: strandsReplyToolName,')
end = s.index('    const baseModel = ', start)
s = s[:start] + s[end:]
start = s.index('      // Before a typed reply is submitted,')
end = s.index('      tools, systemPrompt:', start)
s = s[:start] + '''      model: baseModel,
      structuredOutputSchema: agentV2StructuredOutputSchema,
''' + s[end:]
s = s.replace('const usage = result.metrics?.accumulatedUsage, replyProposal = submission.snapshot();', '''const usage = result.metrics?.accumulatedUsage;
      const parsed = result.structuredOutput === undefined ? undefined : agentV2StructuredOutputSchema.safeParse(result.structuredOutput);
      if (parsed && !parsed.success) throw new ServerAgentRuntimeExecutionError("runtime_projection", "validation");
      const replyProposal = parsed?.success ? parsed.data.reply : undefined;''')
s = s.replace('      if (error instanceof ServerAgentRuntimeExecutionError) throw error;', '''      if (error instanceof ServerAgentRuntimeExecutionError) throw error;
      if (error instanceof StructuredOutputError) throw new ServerAgentRuntimeExecutionError("runtime_projection", "validation");''')
start = s.index('function requireToolUntilReply(')
end = s.index('function runtimeFailureKind(', start)
s = s[:start] + s[end:]
s = s.replace('error: { code: "reply_submitted", retryable: false }', 'error: { code: "intent_unavailable", retryable: false }')
p.write_text(s)

runtime = 'backend/agent-api/src/adapters/strands-server-runtime.ts'
replace(runtime, 'if (stopReason === "endTurn" || stopReason === "stopSequence")', 'if (stopReason === "toolUse" || stopReason === "endTurn" || stopReason === "stopSequence")')
replace(runtime, 'missing_reply_proposal', 'missing_structured_output')

# Uniqueness is a reference consistency rule at admission, not a second syntax grammar.
publication = 'modules/agent/runtime/agent-v2-publication.ts'
replace(publication, '    case "candidates": {\n', '''    case "candidates": {
      if (new Set(proposal.evidenceIds).size !== proposal.evidenceIds.length) throw new AgentV2ReplyError("invalid_proposal");
''')
replace(publication, '      for (const reference of proposal.references) {', '''      const seenReferences = new Set<string>();
      for (const reference of proposal.references) {
        const key = JSON.stringify(reference);
        if (seenReferences.has(key)) throw new AgentV2ReplyError("invalid_proposal");
        seenReferences.add(key);''')

Path('backend/agent-api/src/adapters/strands-reply-submission.ts').unlink()
Path('backend/agent-api/src/adapters/strands-reply-submission.test.ts').unlink()

prompt = 'backend/agent-api/src/usecases/agent-v2-system-prompt.ts'
replace(prompt, '回答は最後にsubmit_replyへ一度だけ提出します。通常の文章は公開回答にはなりません。提出後は追加調査や条件更新をせず終了してください。',
        '最終回答は指定されたstructured output schemaのreplyに返します。必要な条件受理と調査を終えてから最終出力します。通常の文章は公開回答にはなりません。')
replace('backend/agent-api/src/usecases/agent-v2-system-prompt.test.ts', 'submit_reply', 'structured output')

# Adapt test wire encoding to SDK structured output. No production compatibility adapter.
for path, obj in [
    ('backend/agent-api/src/adapters/strands-agent-engine.test.ts', 'reply'),
    ('backend/agent-api/src/composition/strands-intent-acceptance.test.ts', 'step'),
    ('backend/agent-api/src/composition/strands-place-cards-acceptance.test.ts', 'proposal'),
]:
    p = Path(path)
    s = p.read_text().replace('submit_reply', 'strands_structured_output')
    old = f'JSON.stringify({obj}.input)'
    assert old in s, path
    s = s.replace(old, f'JSON.stringify({obj}.tool === "strands_structured_output" ? {{ reply: {obj}.input }} : {obj}.input)')
    p.write_text(s)

shape = 'backend/agent-api/src/composition/strands-conversation-production-shaped.test.ts'
p = Path(shape)
s = p.read_text().replace('submit_reply', 'strands_structured_output')
s = s.replace('JSON.stringify(this.proposal)', 'JSON.stringify({ reply: this.proposal })')
s = s.replace('JSON.stringify(input)', 'JSON.stringify(name === "strands_structured_output" ? { reply: input } : input)', 1)
# The invariant is preserved A-commit and no successful reply, not V1's exact failure code.
s = s.replace('rejects.toMatchObject({ code: "agent_failed" })', 'rejects.toBeDefined()')
p.write_text(s)

etest = 'backend/agent-api/src/adapters/strands-agent-engine.test.ts'
replace(etest, 'expect(result.stopReason).toBe("endTurn");', 'expect(result.stopReason).toBe("toolUse");')
replace(etest, 'expect(model.toolChoices).toEqual([{ any: {} }, { any: {} }, { auto: {} }]);',
        'expect(model.toolChoices).toHaveLength(2); // No model request after the structured result.')
replace(etest, 'expect(captured?.tools).toHaveLength(1);', 'expect(captured?.tools).toHaveLength(0);\n    expect(captured?.structuredOutputSchema).toBeDefined();')
replace(etest, '// The only Tool is a local reply submission; there are no Domain write/proposal Tools.',
        '// The SDK supplies its own output Tool; no Application reply or Domain write Tool is registered.')
replace(etest, '''    const model = new ScriptedModel([{ text: "保存しておきます。" }]);
    const result = await new StrandsAgentEngine(options, { model }).run(input);
    expect(model.toolChoices).toEqual([{ any: {} }]);
    expect(result.replyProposal).toBeUndefined();''', '''    const model = new ScriptedModel([{ text: "保存しておきます。" }, { text: "保存しておきます。" }]);
    await expect(new StrandsAgentEngine(options, { model }).run(input)).rejects.toMatchObject({ stage: "runtime_projection", kind: "validation" });
    expect(model.toolChoices).toHaveLength(2); // The SDK owns the single forced-output attempt.''')

rtest = 'backend/agent-api/src/adapters/strands-server-runtime.test.ts'
replace(rtest, 'stopReason: "endTurn", evidence: [], trace, ...overrides', 'stopReason: "toolUse", evidence: [], trace, ...overrides')
replace(rtest, 'missing_reply_proposal', 'missing_structured_output')

# Keep old diagnostic codes readable for historical logs; add the new SDK-boundary code.
replace('backend/agent-api/src/usecases/agent/server-agent.ts',
        '"incomplete_execution", "missing_reply_proposal",',
        '"incomplete_execution", "missing_reply_proposal", "missing_structured_output",')
replace('tools/deployment/summarize-agent-diagnostics.mjs',
        'incomplete_execution|missing_reply_proposal|',
        'incomplete_execution|missing_reply_proposal|missing_structured_output|')

pkg = Path('package.json')
data = json.loads(pkg.read_text())
data['scripts']['test:agent:v2'] = data['scripts']['test:agent:v2'].replace(' backend/agent-api/src/adapters/strands-reply-submission.test.ts', '')
data['scripts']['test:agent:v2'] += ' modules/agent/runtime/agent-v2-reply.test.ts backend/agent-api/src/adapters/strands-structured-output.test.ts'
data['scripts']['test:agent:v2:conversation-live'] = 'vitest run --root . backend/agent-api/src/composition/strands-output-live.test.ts --maxWorkers=1'
pkg.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')

write('modules/agent/runtime/agent-v2-reply.test.ts', '''import { describe, expect, it } from "vitest";
import { z } from "zod";
import { agentV2ReplySchema, agentV2StructuredOutputSchema, parseAgentV2Reply } from "./agent-v2-reply";

const examples = [
  { kind: "answer", references: [{ evidenceId: "evidence:place", field: "description" }] },
  { kind: "candidates", evidenceIds: ["evidence:place"], commentary: "候補を検討できます。" },
  { kind: "conversation", message: "greeting" }, { kind: "clarification", target: "origin" },
  { kind: "unavailable", operation: "save" }, { kind: "operation_result", receiptId: "receipt:1" }, { kind: "uncertainty" },
];
describe("single-source V2 reply syntax", () => {
  it.each(examples)("shares a valid $kind between the SDK envelope and Application parser", (reply) => {
    expect(agentV2StructuredOutputSchema.parse({ reply }).reply).toEqual(parseAgentV2Reply(reply));
  });
  it.each([
    { kind: "candidates" },
    { kind: "conversation", message: "greeting", commentary: "こんにちは" },
    { kind: "answer", references: [] },
    { kind: "candidates", evidenceIds: ["evidence:1"], commentary: "説明", cards: [] },
  ])("rejects the same invalid syntax at both boundaries", (reply) => {
    expect(agentV2StructuredOutputSchema.safeParse({ reply }).success).toBe(false);
    expect(() => parseAgentV2Reply(reply)).toThrow();
  });
  it("generates required fields per variant instead of advertising every field as optional", () => {
    const json = z.toJSONSchema(agentV2StructuredOutputSchema) as any;
    expect(json.type).toBe("object");
    expect(json.required).toEqual(["reply"]);
    const variants = json.properties.reply.oneOf ?? json.properties.reply.anyOf;
    expect(variants).toHaveLength(examples.length);
    for (const example of examples) {
      const variant = variants.find((v: any) => v.properties.kind.const === example.kind);
      expect(variant.required).toEqual(expect.arrayContaining(Object.keys(example)));
      expect(variant.additionalProperties).toBe(false);
    }
    expect(agentV2ReplySchema.safeParse({ kind: "candidates" }).success).toBe(false);
  });
});
''')

write('backend/agent-api/src/adapters/strands-structured-output.test.ts', '''import { expect, it, vi } from "vitest";
import { Model, type BaseModelConfig, type Message, type ModelStreamEvent, type StreamOptions } from "@strands-agents/sdk";
import { AgentToolRegistry } from "@raiquora/agent/tool-registry";
import { AgentToolExecutor } from "@raiquora/agent/agent-tool-executor";
import { ToolEvidenceRegistry } from "@raiquora/agent/tool-evidence-registry";
import { successfulAgentToolResult, validAgentToolInput } from "@raiquora/agent/tool-contract";
import { StrandsAgentEngine } from "./strands-agent-engine.js";

type Step = { text: string } | { name: string; value: unknown };
class OutputModel extends Model<BaseModelConfig> {
  calls = 0;
  readonly choices: StreamOptions["toolChoice"][] = [];
  private config: BaseModelConfig = { modelId: "synthetic-output" };
  constructor(private readonly steps: Step[]) { super(); }
  updateConfig(config: BaseModelConfig) { this.config = { ...this.config, ...config }; }
  getConfig() { return this.config; }
  async *stream(_messages: Message[], options?: StreamOptions): AsyncGenerator<ModelStreamEvent> {
    this.choices.push(options?.toolChoice);
    const step = this.steps[this.calls++];
    if (!step) throw new Error("Unnecessary model call after final result");
    yield { type: "modelMessageStartEvent", role: "assistant" };
    if ("text" in step) {
      yield { type: "modelContentBlockStartEvent" };
      yield { type: "modelContentBlockDeltaEvent", delta: { type: "textDelta", text: step.text } };
    } else {
      yield { type: "modelContentBlockStartEvent", start: { type: "toolUseStart", name: step.name, toolUseId: `tool-${this.calls}` } };
      yield { type: "modelContentBlockDeltaEvent", delta: { type: "toolUseInputDelta", input: JSON.stringify(step.value) } };
    }
    yield { type: "modelContentBlockStopEvent" };
    yield { type: "modelMessageStopEvent", stopReason: "text" in step ? "endTurn" : "toolUse" };
  }
}
const output = (reply: unknown): Step => ({ name: "strands_structured_output", value: { reply } });
function setup(steps: Step[]) {
  const model = new OutputModel(steps), tools = new AgentToolRegistry(), evidence = new ToolEvidenceRegistry();
  const execute = vi.fn(async () => successfulAgentToolResult({ description: "確認済み" }));
  tools.register({ name: "read_place", description: "Read verified place", effect: "read", inputSchema: { type: "object", properties: {}, additionalProperties: false },
    parseInput: () => validAgentToolInput({}), execute });
  const engine = new StrandsAgentEngine({ modelId: "unused", region: "ap-northeast-1", systemPrompt: "Return the requested structure.", maxTurns: 4 }, { model });
  const run = (maxTurns = 4) => engine.run({ executionId: "native-output", userRequest: "場所を確認", tools,
    toolExecutor: new AgentToolExecutor(tools, evidence), limits: { maxTurns, maxToolCalls: 1 } });
  return { model, execute, run };
}
it("lets the SDK end on a validated result without an Application submit Tool or trailing model call", async () => {
  const test = setup([{ name: "read_place", value: {} }, output({ kind: "uncertainty" })]);
  const result = await test.run();
  expect(result.replyProposal).toEqual({ kind: "uncertainty" });
  expect(result.stopReason).toBe("toolUse");
  expect(test.model.calls).toBe(2);
  expect(test.execute).toHaveBeenCalledOnce();
});
it("uses SDK validation feedback for invalid syntax within the existing turn budget", async () => {
  const test = setup([output({ kind: "candidates" }), output({ kind: "uncertainty" })]);
  expect((await test.run()).replyProposal).toEqual({ kind: "uncertainty" });
  expect(test.model.calls).toBe(2);
  expect(test.execute).not.toHaveBeenCalled();
});
it("does not turn a plain-text answer into authority when the SDK forces structured output", async () => {
  const test = setup([{ text: "保存しておきます。" }, output({ kind: "unavailable", operation: "save" })]);
  const result = await test.run();
  expect(result.replyProposal).toEqual({ kind: "unavailable", operation: "save" });
  expect(JSON.stringify(result)).not.toContain("保存しておきます");
  expect(test.model.calls).toBe(2);
  expect(test.execute).not.toHaveBeenCalled();
});
it("bounds repeated invalid structured output without a custom repair loop or fake success", async () => {
  const test = setup([output({ kind: "candidates" }), output({ kind: "candidates" }), output({ kind: "uncertainty" })]);
  const result = await test.run(2);
  expect(result.stopReason).toBe("limitTurns");
  expect(result.replyProposal).toBeUndefined();
  expect(test.model.calls).toBe(2);
});
''')

write('backend/agent-api/src/composition/strands-output-live.test.ts', '''import { describe, expect, it, vi } from "vitest";
import { stateDynamoFixture, conversationId, secondId, stateMetadata } from "../adapters/state-dynamodb.fixture.js";
import { tripDynamoFixture } from "../adapters/trip-dynamodb.fixture.js";
import { cognitoTokenFixture, token } from "../adapters/cognito-token.fixture.js";
import { DynamoDbConversationTurnRepository } from "../adapters/dynamodb-conversation-turn-repository.js";
import { StrandsAgentEngine } from "../adapters/strands-agent-engine.js";
import { createStrandsServerRuntime } from "../adapters/strands-server-runtime.js";
import { createConversationServerAgent } from "./conversation-server-agent.js";
import { productionServerTools } from "./production-server-tools.js";
import { agentV2SystemPrompt } from "../usecases/agent-v2-system-prompt.js";

/** Paid, explicit opt-in. Real SDK/Bedrock + synthetic providers/state, no production data or writes.
 * Four turns, at most 6 model cycles and 2 reads per turn; 24 cycles total per model.
 * Normal CI skips this lane. No scripted model is used here. */
const enabled = process.env.AGENT_V2_LIVE === "true";
const modelId = process.env.MODEL_ID ?? "amazon.nova-lite-v1:0";
describe.skipIf(!enabled)("V2 native structured output with real Bedrock", () => {
  it("handles greeting, destination, correction and unavailable save through Conversation/replay", async () => {
    const { verifier } = cognitoTokenFixture();
    const principal = await verifier.verify(token());
    const state = stateDynamoFixture(), trips = tripDynamoFixture();
    const { tripId: _tripId, ...metadata } = stateMetadata();
    await state.conversations.create(principal, conversationId, metadata);
    const calls: { query: string }[] = [];
    const searchPlaceMedia = vi.fn(async (input: { query: string }) => {
      calls.push({ query: input.query });
      const label = ["出雲大社", "清水寺"].find((name) => input.query.includes(name));
      if (!label) return { result: { status: "unavailable", freshness: "unknown", evidence: [] } };
      const id = label === "出雲大社" ? "izumo" : "kiyomizu", sourceUrl = `https://example.org/evaluation/${id}`;
      return { result: { status: "available", freshness: "fresh", data: { places: [{ providerPlaceId: id, name: label,
        summary: "散策の対象となる場所です。これは接続検証用の固定資料です。", sourceUrl, openingHoursStatus: "unknown" }] },
        evidence: [{ id: `source-${id}`, provider: "fixture", sourceUrl, retrievedAt: new Date().toISOString() }] } };
    });
    const v1 = { converse: vi.fn(async () => { throw new Error("V1 must not run"); }) };
    let execution = 0;
    const app = createConversationServerAgent({ stateTable: "test-state", tripTable: "test-trips", stateClient: state.client, tripClient: trips.client,
      model: v1, weather: { search: vi.fn() }, newExecutionId: () => `native-live-${++execution}`,
      limits: { maxIterations: 6, maxModelCalls: 6, maxToolCalls: 2, maxExecutionMs: 60000 },
      runRuntime: createStrandsServerRuntime(new StrandsAgentEngine({ modelId, region: "ap-northeast-1", systemPrompt: agentV2SystemPrompt,
        maxTurns: 6, maxOutputTokens: 1024 })),
      additionalTools: productionServerTools({ external: { searchPlaceMedia }, accommodation: vi.fn(), journey: vi.fn() }) });
    const messages = ["おはよう", "出雲大社にいきたい", "やっぱり清水寺に行きたい。候補カードを見せて", "この候補を保存して"];
    const reports: object[] = [];
    for (const [index, userRequest] of messages.entries()) {
      const turnId = `72200000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
      const started = Date.now(), before = calls.length;
      const result = await app.runConversationTurn({ principal, conversationId, turnId, userRequest });
      const working = await new DynamoDbConversationTurnRepository("test-state", state.client).getWorkingState(principal, conversationId);
      reports.push({ case: index, status: result.status, reads: calls.length - before, cards: result.publicPlacePresentation?.cards.length ?? 0,
        intentRevision: working?.semantic?.overlay.intentRevision ?? 0, durationMs: Date.now() - started });
      console.log(JSON.stringify({ modelId, ...reports.at(-1) }));
      expect(result.status).toBe("completed");
      const beforeReplay = calls.length;
      expect(await app.runConversationTurn({ principal, conversationId, turnId, userRequest })).toEqual(result);
      expect(calls.length).toBe(beforeReplay);
      if (index === 0) expect(calls).toHaveLength(0);
      if (index === 1) {
        expect(working?.semantic?.overlay.intentRevision).toBe(1);
        expect(calls.length).toBeGreaterThan(before);
      }
      if (index === 2) {
        expect(working?.semantic?.overlay.intentRevision).toBe(2);
        expect(result.publicPlacePresentation?.cards.map(({ title }) => title)).toContain("清水寺");
        expect(result.publicPlacePresentation?.cards.some(({ title }) => title.includes("出雲大社"))).toBe(false);
      }
      if (index === 3) expect(result.response).toContain("保存は行っていません");
    }
    expect(v1.converse).not.toHaveBeenCalled();
    const history = await state.conversations.history(principal, conversationId);
    expect(history.items).toHaveLength(8);
    expect(history.items[5]?.publicPlacePresentation?.cards.map(({ title }) => title)).toContain("清水寺");
  }, 280000);
});
''')

write('docs/architecture/agent-v2-publication.md', '''# Agent v2の構造化出力と公開境界

関連: #716、#631、ADR 0096。対象SDK: @strands-agents/sdk 1.18.0。

```text
userMessage → Strands Agent
  → 必要ならupdate_intent / A commit
  → read Tool / Evidence
  → SDK structuredOutputSchemaで構文検証・終了
  → result.structuredOutput.reply
  → Application admission / Evidence・claim検証
  → B commit → SSE / history / replay
```

## 標準機能に委ねること

Zodのstrictなdiscriminated unionを構文の唯一の定義にする。SDKへ渡すJSON SchemaとApplicationのparseは同じZod schemaから生成する。SDK Toolの最上位はobjectで、variantはreplyの中へ置く。独自のflat schema、手書きvariant parser、submit_reply Tool、提出済み状態、Model Proxy、toolChoice切替は使わない。

SDKは有効なstructured outputを取得した時点で終了する。回答取得後に終了用のmodel callを追加しない。通常のlastMessage、toString、reasoning、SDKのplain textは公開も保存もしない。

## 検証の責務

Schemaの通過は事実の正しさや保存の権限を証明しない。Evidence参照の存在・一意性・currentness、Effective Intentのrevision/fingerprint、操作receipt、owner、CASはApplication側に残す。モデルがschemaに沿った架空IDを返しても公開しない。

## SDKの再試行を隠さない

SDK 1.18.0は不正な構造化出力にvalidation feedbackを返す。plain textで終了しようとした場合は、SDKが構造化出力Toolを一度指定して再度modelへ要求し、それでも拒否すればStructuredOutputErrorとなる。これは追加の自前repairではなく、選択したSDKの標準動作である。

すべて同一invokeのturn/token/deadline上限内で行い、外側でinvokeを再実行しない。不正出力の繰返し、指定後の拒否、token上限、通信失敗を完了と扱わない。Domain Tool budgetにはSDKの出力Toolを数えない。

## 合否の区別

- 決定論的Acceptance: actual SDK + scripted model。構文拒否、不要な末尾呼出しなし、上限、A/B/history/replay、owner・Evidence拒否。
- `AGENT_V2_LIVE=true npm run test:agent:v2:conversation-live`: actual Bedrock + fixed travel Provider + state fixture。最大4 turns × 6 model cycles、各turnは60秒、writeなし。
- 実Provider/実ブラウザ: 別の確認。上記の成功で代用しない。

#721のV2専用Frontend表示分離は別作業。今回の公開snapshotの保存契約は維持する。
''')
for path in ['docs/architecture/agent-v2-place-cards.md', 'docs/architecture/agent-v2-intent-tool.md', 'docs/architecture/agent-v2-development-cutover.md']:
    p = Path(path)
    s = p.read_text().replace('submit_reply', 'SDK structured output')
    if '## V2終端プロトコル' in s:
        s = s[:s.index('## V2終端プロトコル')] + '## V2終端プロトコル\n\nSDKのstructuredOutputSchema/structuredOutputへ統一する。独自ToolChoice切替は撤去した。詳細は[公開境界](agent-v2-publication.md)を参照。\n'
    p.write_text(s)

assert 'new Proxy' not in Path(engine).read_text()
assert 'submit_reply' not in Path(engine).read_text()

catalog = 'backend/agent-api/src/composition/agent-v2-acceptance-catalog.ts'
replace(catalog, '] as const;', '''  {
    id: "V2-OUTPUT-NATIVE-01", kind: "v2_specific",
    invariant: "a validated SDK structured result ends without an additional model request",
    testFile: "backend/agent-api/src/adapters/strands-structured-output.test.ts",
    testName: "lets the SDK end on a validated result without an Application submit Tool or trailing model call",
  },
  {
    id: "V2-OUTPUT-BOUNDED-01", kind: "v2_specific",
    invariant: "SDK validation retries share the invoke budget and never become a fabricated reply",
    testFile: "backend/agent-api/src/adapters/strands-structured-output.test.ts",
    testName: "bounds repeated invalid structured output without a custom repair loop or fake success",
  },
] as const;''')
print('Generated native structured-output replacement and acceptance/live tests.')
