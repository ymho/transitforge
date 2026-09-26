# Temporary development migration. Removed before PR completion; never runtime code.
from pathlib import Path
r = Path.cwd()
p=r/'modules/agent/runtime/conversation-condition.ts'
s=p.read_text().replace('import type { IntentApplicationReceipt }', 'import { parseIntentApplicationReceipt, type IntentApplicationReceipt }')
s += '''

const conditionJournalSchema = z.strictObject({ version: z.literal(1), operations: z.array(z.strictObject({
  target: z.enum(conditionTargets), payloadHash: z.string().regex(/^[0-9a-f]{64}$/u), receipt: z.unknown(),
})).min(1).max(conditionTargets.length) });
export interface ConditionOperationRecord { target: ConditionTarget; payloadHash: string; receipt: IntentApplicationReceipt }
export interface ConditionOperationJournal { version: 1; operations: ConditionOperationRecord[] }

/** Persisted receipt syntax, not another conditions database. Identity is checked against
 * the owning turn so a valid receipt cannot be spliced into a different turn record. */
export function parseConditionJournal(value: unknown, turnId: string): ConditionOperationJournal {
  const parsed = conditionJournalSchema.parse(value), seen = new Set<ConditionTarget>();
  let previousRevision: number | undefined;
  const operations = parsed.operations.map(item => {
    const receipt = parseIntentApplicationReceipt(item.receipt), operation = receipt.operations[0];
    const id = conditionOperationId(turnId, item.target);
    if (seen.has(item.target) || receipt.mutationId !== id || receipt.operations.length !== 1 ||
        !operation || operation.operationId !== id || operation.groupId !== id || operation.target !== item.target ||
        operation.scope.type !== "conversation" || operation.frame !== "actual" || operation.status !== "accepted" ||
        !["set", "retract"].includes(operation.action) || receipt.intentRevision !== receipt.beforeIntentRevision + 1 ||
        previousRevision !== undefined && receipt.beforeIntentRevision !== previousRevision) throw new Error("Invalid condition journal");
    seen.add(item.target); previousRevision = receipt.intentRevision;
    return { target: item.target, payloadHash: item.payloadHash, receipt };
  });
  return { version: 1, operations };
}
'''
a=s.index('/** Each Tool');b=s.index('export type PlaceConditionInput',a)
s=s[:a]+r'''/** Set and clear are distinct business commands. Omitted/unknown values must never
 * be confused with retraction. Places are user labels, not geocoded facts. */
const sourceQuote = z.string().min(1).max(300).describe("この操作を求めるuserMessageの完全な部分文字列。");
const placeLabel = z.string().min(1).max(200).regex(/^(?!\s)(?![\s\S]*\s$)[^\u0000-\u001f\u007f<>]+$/u)
  .describe("今回の発言からそのまま取り出した地名。");
export const placeConditionInputSchema = z.strictObject({ place: placeLabel, quote: sourceQuote });
export const clearConditionInputSchema = z.strictObject({ quote: sourceQuote });
export const conditionTargets = ["origin", "destination"] as const;
/** Internal command only. Tools cannot choose target, identity, scope or revision. */
export const conversationConditionSchema = placeConditionInputSchema.extend({
  target: z.enum(conditionTargets), place: placeLabel.nullable(),
});
'''+s[b:];p.write_text(s)
p=r/'backend/agent-api/src/ports/conversation-turn-repository.ts'
s=p.read_text().replace('receipt: import("@raiquora/agent/conversation-intent-reducer").IntentApplicationReceipt } |', 'receipt: import("@raiquora/agent/conversation-intent-reducer").IntentApplicationReceipt; conditionReceipts?: import("@raiquora/agent/conversation-intent-reducer").IntentApplicationReceipt[] } |');p.write_text(s)
p=r/'backend/agent-api/src/adapters/dynamodb-conversation-turn-repository.ts';s=p.read_text()
s=s.replace('import { createHash, randomUUID }', 'import { conditionDelta, conditionPayload, conversationConditionSchema, parseConditionJournal,\n  type ConditionOperationJournal, type ConditionOperationRecord, type ConversationConditionChange } from "@raiquora/agent/conversation-condition";\nimport type { ConversationConditionRepository } from "../ports/conversation-condition-repository.js";\nimport { createHash, randomUUID }')
s=s.replace('stateId, type StateClock }','stateId, type StateClock, type Conversation }')
s=s.replace('type AcceptedIntentDelta }', 'type AcceptedIntentDelta, type ConversationIntentOverlay }')
s=s.replace('  intentReceipt?: IntentApplicationReceipt;','  intentReceipt?: IntentApplicationReceipt;\n  /** Added in condition writer v1. Absence with intentReceipt means a sealed legacy turn. */\n  conditionUpdates?: ConditionOperationJournal;')
s=s.replace('function finalResult(', 'interface TurnSnapshot { current: Conversation; old?: StateEnvelope; turn?: TurnRecord }\nfunction finalResult(')
s=s.replace('implements ConversationTurnRepository, IntentProposalAdoptionPort', 'implements ConversationTurnRepository, ConversationConditionRepository, IntentProposalAdoptionPort')
s=s.replace('private decodeTurn(envelope: StateEnvelope): TurnRecord', 'private decodeTurn(envelope: StateEnvelope, turnId: string): TurnRecord')
s=s.replace('"targetTripId", "intentReceipt"]);', '"targetTripId", "intentReceipt", "conditionUpdates"]);')
s=s.replace('      if (value.intentReceipt !== undefined) parseIntentApplicationReceipt(value.intentReceipt);', '''      if (value.intentReceipt !== undefined) parseIntentApplicationReceipt(value.intentReceipt);
      if (value.conditionUpdates !== undefined) {
        const journal = parseConditionJournal(value.conditionUpdates, turnId);
        if (JSON.stringify(journal.operations.at(-1)!.receipt) !== JSON.stringify(value.intentReceipt)) throw new Error();
      }''')
s=s.replace('private async read(input: ConversationTurnIdentity) {','private async read(input: ConversationTurnIdentity): Promise<TurnSnapshot> {')
s=s.replace('this.decodeTurn(old)', 'this.decodeTurn(old, input.turnId)')
s=s.replace('    const now = this.now(current.updatedAt), time = Date.parse(now);', '''    // A later user message supersedes unfinished older work. Completed turns replay
    // above; they never re-run a writer or rewind current accepted conditions.
    if (turn && current.messageCount !== turn.userSequence) throw new StateError("conflict");
    const now = this.now(current.updatedAt), time = Date.parse(now);''')
s=s.replace('...(turn?.intentReceipt ? { intentReceipt: turn.intentReceipt } : {}) };', '...(turn?.intentReceipt ? { intentReceipt: turn.intentReceipt } : {}),\n      ...(turn?.conditionUpdates ? { conditionUpdates: turn.conditionUpdates } : {}) };')
s=s.replace('receipt: next.intentReceipt } :', 'receipt: next.intentReceipt,\n      ...(next.conditionUpdates ? { conditionReceipts: next.conditionUpdates.operations.map(({ receipt }) => structuredClone(receipt)) } : {}) } :')
a=s.index('  async acceptIntent(');b=s.index('    const working = parseConversationWorkingState({',a)
s=s[:a]+'''  async acceptIntent(identity: ConversationTurnIdentity, lease: ConversationTurnLease, candidate: AcceptedIntentDelta): Promise<IntentApplicationReceipt> {
    const input = this.identity(identity), delta = parseAcceptedIntentDelta(candidate), snapshot = await this.read(input);
    this.validateLease(snapshot.turn, lease);
    if (snapshot.turn!.conditionUpdates) throw new StateError("conflict");
    if (snapshot.turn!.intentReceipt) {
      if (snapshot.turn!.intentReceipt.mutationId !== delta.mutationId) throw new StateError("conflict");
      return snapshot.turn!.intentReceipt;
    }
    return this.commitIntent(input, snapshot, lease, () => delta);
  }

  async acceptCondition(identity: ConversationTurnIdentity, lease: ConversationTurnLease, candidate: ConversationConditionChange): Promise<IntentApplicationReceipt> {
    const input = this.identity(identity), change = conversationConditionSchema.parse(candidate), snapshot = await this.read(input);
    this.validateLease(snapshot.turn, lease);
    const turn = snapshot.turn!;
    // Do not resume a legacy accepted turn as a new multi-operation turn.
    if (turn.intentReceipt && !turn.conditionUpdates) throw new StateError("conflict");
    const payloadHash = createHash("sha256").update(conditionPayload(change)).digest("hex");
    const recorded = turn.conditionUpdates?.operations.find(({ target }) => target === change.target);
    if (recorded) {
      if (recorded.payloadHash !== payloadHash) throw new StateError("conflict");
      return structuredClone(recorded.receipt);
    }
    return this.commitIntent(input, snapshot, lease, overlay => conditionDelta(change, input.turnId, overlay),
      { target: change.target, payloadHash });
  }

  private validateLease(turn: TurnRecord | undefined, lease: ConversationTurnLease): void {
    exactObject(lease, ["attemptId", "userSequence"]); stateId(lease.attemptId);
    if (!turn || turn.attemptId !== lease.attemptId || turn.userSequence !== lease.userSequence) throw new StateError("conflict");
  }

  /** The accepted state and its durable replay receipt share one existing CAS transaction. */
  private async commitIntent(input: ConversationTurnIdentity, snapshot: TurnSnapshot, lease: ConversationTurnLease,
    candidate: (overlay: ConversationIntentOverlay) => AcceptedIntentDelta, record?: Omit<ConditionOperationRecord, "receipt">): Promise<IntentApplicationReceipt> {
    const { current, old, turn } = snapshot;
    this.validateLease(turn, lease);
    const now = this.now(current.updatedAt);
    if (!turn || !["started", "intent_accepted"].includes(turn.state) || turn.leaseUntil <= Date.parse(now) ||
        current.messageCount !== turn.userSequence) throw new StateError("conflict");
    const workingKey = this.workingKey(input.conversationId), oldWorking = await this.store.read(input.principal, workingKey);
    const previousWorking = oldWorking ? parseConversationWorkingState(oldWorking.payload) : undefined;
    if (previousWorking && previousWorking.sourceUserSequence > turn.userSequence) throw new StateError("conflict");
    const semantic = semanticStateOf(previousWorking);
    if (semantic.adoptionInFlight) throw new StateError("conflict");
    let reduction;
    try { reduction = reduceConversationIntent(semantic.overlay, candidate(semantic.overlay)); }
    catch { throw new StateError("conflict"); }
    // An individual business command either applies or is rejected without a commit.
    if (record && reduction.receipt.operations.some(({ status }) => status !== "accepted")) throw new StateError("invalid-input");
'''+s[b:]
s=s.replace('const next: TurnRecord = { ...turn, state: "intent_accepted", intentReceipt: reduction.receipt };', '''const conditionUpdates = record ? parseConditionJournal({ version: 1,
      operations: [...(turn.conditionUpdates?.operations ?? []), { ...record, receipt: reduction.receipt }] }, input.turnId) : undefined;
    const next: TurnRecord = { ...turn, state: "intent_accepted", intentReceipt: reduction.receipt,
      ...(conditionUpdates ? { conditionUpdates } : {}) };''')
s=s.replace('    if (saved && current.messageCount >= 999_999_999_999)', '    if (saved && current.messageCount !== turn.userSequence) throw new StateError("conflict");\n    if (saved && current.messageCount >= 999_999_999_999)');p.write_text(s)
p=r/'backend/agent-api/src/usecases/agent/conversation-turn.ts';s=p.read_text().replace('acceptedIntentDeltaFromInterpretation, decodeUtteranceInterpretation, type UtteranceInterpretation','acceptedIntentDeltaFromInterpretation, type UtteranceInterpretation')
s=s.replace('import { ServerAgentIntentRejectedError } from "../../ports/server-agent-runtime.js";', '''import { summarizeConditionReceipts, type ConversationConditionChange } from "@raiquora/agent/conversation-condition";
import type { IntentApplicationReceipt } from "@raiquora/agent/conversation-intent-reducer";
import type { ConversationConditionRepository } from "../../ports/conversation-condition-repository.js";
import { createConversationConditionApplication } from "./conversation-condition-application.js";''')
s=s.replace('  turns: ConversationTurnRepository;', '  turns: ConversationTurnRepository;\n  conditions?: ConversationConditionRepository;')
s=s.replace('acceptIntent?: (interpretation: UtteranceInterpretation) => Promise<import("@raiquora/agent/conversation-intent-reducer").IntentApplicationReceipt>', 'acceptCondition?: (change: ConversationConditionChange) => Promise<IntentApplicationReceipt>')
s=s.replace('    let acceptedReceipt = begun.state === "intent_accepted" ? begun.receipt : undefined;', '''    const conditionReceipts = new Map<string, IntentApplicationReceipt>(begun.state === "intent_accepted"
      ? begun.conditionReceipts?.map(receipt => [receipt.mutationId, receipt]) : []);
    let acceptedReceipt = begun.state === "intent_accepted"
      ? summarizeConditionReceipts([...conditionReceipts.values()]) ?? begun.receipt : undefined;''')
a=s.index('      const acceptRuntimeIntent =');b=s.index('      const runtimeInput =',a)
s=s[:a]+'''      // Resuming an operation-aware turn must allow the remaining independent updates.
      // Legacy accepted turns stay sealed; their original receipt remains replayable.
      const allowConditions = dependencies.conditions && !dependencies.interpretIntent &&
        (begun.state === "started" || begun.conditionReceipts !== undefined);
      const applyCondition = allowConditions ? createConversationConditionApplication(dependencies.conditions!, identity, begun.lease, userRequest) : undefined;
      const acceptCondition = applyCondition ? async (change: ConversationConditionChange) => {
        const receipt = await applyCondition(change);
        conditionReceipts.set(receipt.mutationId, receipt);
        acceptedReceipt = summarizeConditionReceipts([...conditionReceipts.values()]);
        await safeDiagnostic(dependencies, semanticDiagnostic(turnId, "accept", "accepted", receipt));
        await reportIntentAccepted?.(publicSemanticReceipt(acceptedReceipt!));
        return receipt;
      } : undefined;
'''+s[b:]
s=s.replace('reportProgress, acceptRuntimeIntent)', 'reportProgress, acceptCondition)').replace('undefined, acceptRuntimeIntent)', 'undefined, acceptCondition)');p.write_text(s)
p=r/'backend/agent-api/src/composition/conversation-server-agent.ts';s=p.read_text().replace('  return createConversationTurnApplication({\n    turns: new DynamoDbConversationTurnRepository(options.stateTable, options.stateClient),','  const turns = new DynamoDbConversationTurnRepository(options.stateTable, options.stateClient);\n  return createConversationTurnApplication({\n    turns, ...(options.runRuntime ? { conditions: turns } : {}),').replace('acceptIntent','acceptCondition');p.write_text(s)
p=r/'backend/agent-api/src/composition/stateful-server-agent.ts';s=p.read_text().replace('type { UtteranceInterpretation } from "@raiquora/agent/semantic-interpretation"','type { ConversationConditionChange } from "@raiquora/agent/conversation-condition"').replace('acceptIntent','acceptCondition').replace('interpretation: UtteranceInterpretation','change: ConversationConditionChange').replace('acceptCondition(interpretation)','acceptCondition(change)').replace('intentController','conditionController').replace('    if (input.conversationId && effectiveIntent && currentIntentReceipt)', '    if (!options.runRuntime && input.conversationId && effectiveIntent && currentIntentReceipt)');p.write_text(s)
p=r/'backend/agent-api/src/usecases/agent/conversation-condition-application.ts';s=p.read_text().replace('      throw error; // Unknown', '      if (error instanceof StateError && error.code === "invalid-input") throw new ConditionUpdateRejectedError("invalid_condition");\n      throw error; // Unknown');p.write_text(s)
p=r/'backend/agent-api/src/adapters/strands-agent-engine.ts';s=p.read_text().replace('placeConditionInputSchema, ConditionUpdateRejectedError, type ConditionTarget, type PlaceConditionInput', 'placeConditionInputSchema, clearConditionInputSchema, ConditionUpdateRejectedError, type ConditionTarget, type ConversationConditionChange').replace('["set_destination", "set_origin"] as const', '["set_destination", "set_origin", "clear_destination", "clear_origin"] as const').replace('value: PlaceConditionInput', 'value: Omit<ConversationConditionChange, "target">')
s=s.replace('未定に戻す明示依頼はplace=null。', '撤回はclear_destinationを使う。',1)
pos=s.index('description: "今回の相談の出発地');s=s[:pos]+s[pos:].replace('未定に戻す明示依頼はplace=null。','撤回はclear_originを使う。',1)
anchor='          callback: (value, context) => apply("origin", value, context?.cancelSignal) }),'
s=s.replace(anchor,anchor+'''
        tool({ name: "clear_destination", inputSchema: clearConditionInputSchema,
          description: "利用者が今回の行き先を取り消し・未定に戻すことを明示した場合だけ、その行き先条件を撤回する。他の条件は変えない。変更なし・仮定・比較の質問では使わない。",
          callback: (value, context) => apply("destination", { ...value, place: null }, context?.cancelSignal) }),
        tool({ name: "clear_origin", inputSchema: clearConditionInputSchema,
          description: "利用者が今回の出発地を取り消し・未定に戻すことを明示した場合だけ、その出発地条件を撤回する。他の条件は変えない。変更なし・仮定・比較の質問では使わない。",
          callback: (value, context) => apply("origin", { ...value, place: null }, context?.cancelSignal) }),''');p.write_text(s)
p=r/'backend/agent-api/src/usecases/agent-v2-system-prompt.ts';s=p.read_text().replace('set_destination/set_originで条件を受理してから調査します。placeは発言の地名をそのまま、quoteは根拠となる完全な部分文字列にします。未定に戻すときはplace=null。', '設定・訂正はset_destination/set_origin、撤回はclear_destination/clear_originで受理してから調査します。placeは発言の地名をそのまま、quoteは根拠となる完全な部分文字列にします。');p.write_text(s)
p=r/'backend/agent-api/src/composition/strands-condition-tools-live.test.ts';s=p.read_text().replace('["set_origin", "set_destination", "lookup_place", "strands_structured_output"]','["set_origin", "set_destination", "clear_origin", "clear_destination", "lookup_place", "strands_structured_output"]');p.write_text(s)
