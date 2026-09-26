# Temporary source migration of existing tests. Not part of the final product.
from pathlib import Path
import json
r=Path.cwd()
p=r/'modules/agent/runtime/conversation-condition.test.ts';s=p.read_text().replace('conditionPayload, placeConditionInputSchema','conditionPayload, placeConditionInputSchema, clearConditionInputSchema')
s=s.replace('''    for (const input of [{ place: "京都", quote: "京都" }, { place: null, quote: "未定に戻す" }])
      expect(placeConditionInputSchema.safeParse(input).success).toBe(true);''','''    expect(placeConditionInputSchema.safeParse({ place: "京都", quote: "京都" }).success).toBe(true);
    expect(placeConditionInputSchema.safeParse({ place: null, quote: "未定に戻す" }).success).toBe(false);
    expect(clearConditionInputSchema.safeParse({ quote: "未定に戻す" }).success).toBe(true);
    expect(clearConditionInputSchema.safeParse({ place: "京都", quote: "京都" }).success).toBe(false);''');p.write_text(s)
p=r/'backend/agent-api/src/adapters/strands-agent-engine.test.ts';s=p.read_text();a=s.index('    const interpretation = {',s.index('uses an Application-accepted intent'));b=s.index('    const lookupKobe:',a)
s=s[:a]+'    const update: Reply = { tool: "set_destination", input: { place: "神戸", quote: "神戸" } };\n'+s[b:]
s=s.replace('intentController:','conditionController:')
a=s.index('  it("allows only one intent update per Strands invocation"')
s=s[:a]+'''  it("lets independent condition Tools use the same Application without an invocation-wide limiter", async () => {
    const { input } = setup();
    const apply = vi.fn(async () => ({ receipt: {
      version: "public-semantic-receipt-v1" as const, intentRevision: 4, speechAct: "inform" as const,
      outcome: "accepted" as const, changes: [],
    }, effectiveIntent: effectiveDestination("京都") }));
    await new StrandsAgentEngine(options, { model: new ScriptedModel([
      { tool: "set_destination", input: { place: "京都", quote: "京都" } },
      { tool: "set_origin", input: { place: "大阪", quote: "大阪" } },
      submitted,
    ]) }).run({ ...input, conditionController: { apply } });
    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenCalledWith({ target: "destination", place: "京都", quote: "京都" });
    expect(apply).toHaveBeenCalledWith({ target: "origin", place: "大阪", quote: "大阪" });
  });
});
''';p.write_text(s)
p=r/'backend/agent-api/src/composition/strands-conversation-production-shaped.test.ts';s=p.read_text().replace('name: "update_intent"','name: "set_destination"').replace('Use update_intent before replying.', 'Accept the destination before replying.')
a=s.index('input: JSON.stringify({',s.index('name: "set_destination"'));b=s.index('}) } };',a)+len('}) } };')
s=s[:a]+'input: JSON.stringify({ place: "京都", quote: "京都" }) } };'+s[b:];p.write_text(s)
p=r/'backend/agent-api/src/usecases/agent-v2-system-prompt.test.ts';s=p.read_text().replace('"update_intent"', '"set_destination", "set_origin", "clear_destination"');p.write_text(s)
p=r/'backend/agent-api/src/composition/strands-place-cards-acceptance.test.ts';s=p.read_text();a=s.index('const update: Step =');b=s.index('\nclass ',a+1)
s=s[:a]+'const update: Step = { tool: "set_destination", input: { place: "青葉庭園", quote: "青葉庭園" } };'+s[b:];p.write_text(s)
p=r/'backend/agent-api/src/composition/strands-intent-acceptance.test.ts';s=p.read_text().replace('stateMetadata }','stateMetadata, stateProfile }')
s=s.replace('type Step = { tool: string; input: Record<string, unknown> } | "end";', 'type ToolStep = { tool: string; input: Record<string, unknown> };\ntype Step = ToolStep | ToolStep[] | "end";')
s=s.replace('      yield { type: "modelContentBlockDeltaEvent", delta: { type: "textDelta", text: "not public" } };','      yield { type: "modelContentBlockDeltaEvent", delta: { type: "textDelta", text: "not public" } };\n      yield { type: "modelContentBlockStopEvent" };')
a=s.index('      yield { type: "modelContentBlockStartEvent", start: { type: "toolUseStart"');b=s.index('    yield { type: "modelMessageStopEvent"',a)
s=s[:a]+'''      for (const [index, call] of (Array.isArray(step) ? step : [step]).entries()) {
        yield { type: "modelContentBlockStartEvent", start: { type: "toolUseStart", name: call.tool, toolUseId: `tool-${this.requests.length}-${index}` } };
        yield { type: "modelContentBlockDeltaEvent", delta: { type: "toolUseInputDelta", input: JSON.stringify(call.tool === "strands_structured_output" ? { reply: call.input } : call.input) } };
        yield { type: "modelContentBlockStopEvent" };
      }
    }
'''+s[b:]
a=s.index('function update(');b=s.index('\nconst read',a)
s=s[:a]+'''function update(label = "京都", overrides: Record<string, unknown> = {}): ToolStep {
  return { tool: "set_destination", input: { place: label, quote: label, ...overrides } };
}
const origin = (place = "大阪"): ToolStep => ({ tool: "set_origin", input: { place, quote: place } });
'''+s[b:]
s=s.replace('update("京都", { action: "replace" })','update("京都")')
a=s.index('it.each([');b=s.index('\nit("does not mutate',a)
s=s[:a]+'''it.each([
  ["quote", { quote: "大阪" }],
  ["authority", { owner: "someone-else" }],
  ["scope", { scope: { kind: "logical_day_ordinal", ordinal: 2 } }],
  ["null setter", { place: null }],
] as const)("rejects invalid %s input without changing conditions", async (_kind, overrides) => {
  const test = await setup();
  const { app } = test.build([update("京都", overrides), uncertainty]);
  const result = await app.runConversationTurn(test.input);
  expect(result.semanticReceipt).toBeUndefined();
  expect((await test.turns.getWorkingState(test.principal, conversationId))?.semantic?.overlay.intentRevision ?? 0).toBe(0);
  expect(test.operation).not.toHaveBeenCalled();
  expect(test.v1Model.converse).not.toHaveBeenCalled();
});
'''+s[b:]
a=s.index('it("does not retry an intent');b=s.index('\nit("fails closed',a)
s=s[:a]+'''it("executes independent conditions in one model response before reading and replaying the final reply", async () => {
  const test = await setup();
  const { app, model } = test.build([[origin(), update()], read(), answer("intent-acceptance")]);
  const input = { ...test.input, userRequest: "大阪から京都に行きたい" };
  const result = await app.runConversationTurn(input);
  expect(result.semanticReceipt?.changes.map(({ target }) => target).sort()).toEqual(["destination", "origin"]);
  const state = await test.turns.getWorkingState(test.principal, conversationId);
  expect(state?.semantic?.overlay.facts).toEqual(expect.arrayContaining([
    expect.objectContaining({ target: "origin", value: { kind: "place_label", label: "大阪" } }),
    expect.objectContaining({ target: "destination", value: { kind: "place_label", label: "京都" } }),
  ]));
  expect(test.operation).toHaveBeenCalledOnce();
  expect(model.requests).toHaveLength(3); // A specific two-call batch does not need a separate model round-trip per write.
  expect(await app.runConversationTurn(input)).toEqual(result);
  expect(model.requests).toHaveLength(3);
  expect(result.consultationRequestProposal).toBeUndefined();
  expect(result.tripUpdateProposal).toBeUndefined();
});

it("uses standard Tool validation feedback and accepts a valid operation after rejected input", async () => {
  const test = await setup();
  const { app } = test.build([update("京都", { place: null }), update(), read(), answer("intent-acceptance")]);
  const result = await app.runConversationTurn(test.input);
  expect(result.semanticReceipt?.intentRevision).toBe(1);
  expect(test.operation).toHaveBeenCalledOnce();
});
'''+s[b:]
s=s.replace('const retry = test.build([read(), answer("intent-retry"), "end"], "intent-retry");','const retry = test.build([update(), read(), answer("intent-retry")], "intent-retry");')
s=s.replace('expect(retry.runRuntime.mock.calls[0]?.[0].intentController).toBeUndefined();','expect(retry.runRuntime.mock.calls[0]?.[0].conditionController).toBeDefined();')
s+='''

it("overrides profile hints only in this Conversation and retracts without reviving a hidden default", async () => {
  const test = await setup();
  const savedProfile = await test.state.profiles.put(test.principal, { ...stateProfile(), home: { station: "神戸" } }, null);
  const first = test.build([origin(), update(), read(), answer("profile-first")], "profile-first");
  const input = { ...test.input, userRequest: "今回は大阪から京都に行きたい" };
  const result = await first.app.runConversationTurn(input);
  expect(result.status).toBe("completed");
  expect(await test.state.profiles.get(test.principal)).toEqual(savedProfile);
  const final = test.build([{ tool: "clear_origin", input: { quote: "出発地を未定に戻して" } }, uncertainty], "profile-clear");
  await final.app.runConversationTurn({ ...input, turnId: "71600000-0000-4000-8000-000000000005", userRequest: "出発地を未定に戻して" });
  expect(await test.state.profiles.get(test.principal)).toEqual(savedProfile);
  const probe = test.build([uncertainty], "profile-probe");
  await probe.app.runConversationTurn({ ...input, turnId: "71600000-0000-4000-8000-000000000006", userRequest: "今の条件で相談を続けたい" });
  const effective = probe.runRuntime.mock.calls[0]?.[0].context?.effectiveIntent;
  expect(effective?.actualConversationFacts.some(({ target }) => target === "origin")).toBe(false);
  expect(effective?.profileHints.some(({ target }) => target === "origin")).toBe(false);
  expect(effective?.actualConversationFacts.some(({ target }) => target === "destination")).toBe(true);
});
''';p.write_text(s)
p=r/'backend/agent-api/src/composition/strands-output-live.test.ts';s=p.read_text().replace('import { decodeUtteranceInterpretation } from "@raiquora/agent/semantic-interpretation";', 'import { placeConditionInputSchema, clearConditionInputSchema } from "@raiquora/agent/conversation-condition";').replace('["update_intent", "search_place_media", "strands_structured_output"]','["set_origin", "set_destination", "clear_origin", "clear_destination", "search_place_media", "strands_structured_output"]')
a=s.index('        if (toolUse.name !== "update_intent")');b=s.index('\n      });',a)
s=s[:a]+'''        if (!["set_origin", "set_destination", "clear_origin", "clear_destination"].includes(toolUse.name)) return;
        const schema = toolUse.name.startsWith("clear_") ? clearConditionInputSchema : placeConditionInputSchema;
        console.log(JSON.stringify({ phase: "sdk-condition-input", valid: schema.safeParse(toolUse.input).success }));'''+s[b:]
s=s.replace('["intent_rejected", "intent_unavailable", "intent_update_limit", "invalid_input", "precondition_failed"]','["invalid_condition", "invalid_source", "condition_conflict", "condition_unavailable", "invalid_input", "precondition_failed"]');p.write_text(s)
p=r/'backend/agent-api/src/composition/agent-v2-acceptance-catalog.ts';s=p.read_text().replace('quote, date and scope validation reject ungrounded deltas before A commit','one shared Tool syntax and source validation reject invalid condition input before acceptance').replace('rejects an ungrounded %s delta without committing intent','rejects invalid %s input without changing conditions').replace('a validation rejection cannot start another mutation attempt in the same invocation','the SDK can return validation feedback without an invocation-wide mutation lock').replace('does not retry an intent mutation in the same invocation after validation rejection','uses standard Tool validation feedback and accepts a valid operation after rejected input')
a=s.index('  {\n    id: "V2-TOOL-01"')
s=s[:a]+'''  {
    id: "V2-CONDITIONS-BATCH-01", kind: "v2_specific",
    invariant: "independent conditions in one model response are sequentially accepted before read and replay",
    testFile: "backend/agent-api/src/composition/strands-intent-acceptance.test.ts",
    testName: "executes independent conditions in one model response before reading and replaying the final reply",
  },
  {
    id: "V2-CONDITIONS-RECOVERY-01", kind: "v2_specific",
    invariant: "accepted operations survive a later operation failure and replay never rolls back the latest state",
    testFile: "backend/agent-api/src/adapters/dynamodb-condition-operations.test.ts",
    testName: "retains a committed first operation when the second fails and resumes only the missing work",
  },
  {
    id: "V2-CONDITIONS-FENCE-01", kind: "v2_specific",
    invariant: "an unfinished older turn cannot overwrite newer conditions or publish a stale reply",
    testFile: "backend/agent-api/src/adapters/dynamodb-condition-operations.test.ts",
    testName: "fences unfinished older turns before new writes, new replies or resumed work",
  },
  {
    id: "V2-PROFILE-READ-01", kind: "v2_specific",
    invariant: "current conditions override profile hints without mutating the Profile or reviving a retracted default",
    testFile: "backend/agent-api/src/composition/strands-intent-acceptance.test.ts",
    testName: "overrides profile hints only in this Conversation and retracts without reviving a hidden default",
  },
'''+s[a:];p.write_text(s)
p=r/'package.json';obj=json.loads(p.read_text());obj['scripts']['test:agent:v2']+=' modules/agent/runtime/conversation-condition.test.ts backend/agent-api/src/adapters/dynamodb-condition-operations.test.ts backend/agent-api/src/usecases/agent/conversation-condition-application.test.ts';obj['scripts']['test:agent:v2:condition-live']='vitest run --root . backend/agent-api/src/composition/strands-condition-tools-live.test.ts --maxWorkers=1';p.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n')
p=r/'backend/agent-api/src/usecases/agent/conversation-turn.test.ts';s=p.read_text().replace('1, undefined, expect.any(Function));','1, undefined, undefined);');p.write_text(s)
p=r/'backend/agent-api/src/adapters/strands-server-runtime.test.ts';s=p.read_text().replace('    expect(payload.userMessage).toBe(input.userRequest);','    expect(payload.userMessage).toBe(input.userRequest);\n    expect(payload.application).not.toHaveProperty("capabilities");');p.write_text(s)
