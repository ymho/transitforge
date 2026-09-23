import { expect } from "vitest";
import { GetItemCommand, PutItemCommand, QueryCommand, TransactWriteItemsCommand, type Put } from "@aws-sdk/client-dynamodb";
import type { TrustedPrincipal } from "../contracts/trusted-principal.js";
import type { ConversationMetadata } from "../contracts/server-state.js";
import type { UserProfile } from "@raiquora/trip/travel-profile";
import { DynamoDbConversationRepository } from "./dynamodb-conversation-repository.js";
import { DynamoDbProfileRepository } from "./dynamodb-profile-repository.js";
import type { StateCommand, StateDynamoClient, StateItem } from "./dynamodb-state-store.js";

// Synthetic verified-result fixture. Application integration additionally uses signed JWT verification.
export const stateA: TrustedPrincipal = { subject: `identity-v1:${"a".repeat(64)}`, identity: { issuer: "test-pool", subject: "a" }, scopes: ["raiquora/user"] };
export const stateB: TrustedPrincipal = { subject: `identity-v1:${"b".repeat(64)}`, identity: { issuer: "test-pool", subject: "b" }, scopes: ["raiquora/user"] };
export const conversationId = "11111111-1111-4111-8111-111111111111";
export const secondId = "22222222-2222-4222-8222-222222222222";
export const noCandidateResources = { purgeConversation: async () => ({ complete: true }) };
export const stateMetadata = (): ConversationMetadata => ({ title: "会話", scope: "trip", summary: "相談", resolvedTopics: [], pendingTopics: ["日程"], tripId: secondId });
export const stateProfile = (): UserProfile => ({ version: 2, home: {}, companions: { usual: ["solo"], children: [] }, travelStyle: { pace: 0.123 },
  preferences: { railway: 0.8 }, transport: { maxTypicalTravelMinutes: null }, notes: { budget: "本人のメモ" }, aiNoteFields: [], updatedAt: "2026-09-18T00:00:00.000Z" });

/** Command/condition contract fake, not a live AWS substitute. Transactions commit all or nothing. */
export function stateDynamoFixture() {
  const records = new Map<string, StateItem>(), commands: StateCommand[] = [];
  const key = (item: StateItem) => `${item.pk!.S}/${item.sk!.S}`;
  const faults: { beforeWrite?: () => void | Promise<void>; afterQuery?: () => void | Promise<void>; failPurge?: boolean; lostResponse?: boolean } = {};
  const valid = (put: Put) => {
    const old = records.get(key(put.Item!));
    if (put.ConditionExpression === "attribute_not_exists(pk)") return !old;
    expect(put.ConditionExpression).toBe("revision = :base AND deleted = :deleted");
    return !!old && old.revision?.N === put.ExpressionAttributeValues![":base"]!.N && old.deleted?.BOOL === put.ExpressionAttributeValues![":deleted"]!.BOOL;
  };
  const beforeWrite = async () => { const hook = faults.beforeWrite; delete faults.beforeWrite; await hook?.(); };
  const afterWrite = () => { if (faults.lostResponse) { delete faults.lostResponse; throw new Error("private SDK error"); } };
  const client: StateDynamoClient = { async send(command) {
    commands.push(command);
    if (!(command instanceof TransactWriteItemsCommand)) expect(command.input.TableName).toBe("test-state");
    if (command instanceof GetItemCommand) {
      expect(command.input.ConsistentRead).toBe(true);
      const item = records.get(key(command.input.Key!));
      return item ? { Item: structuredClone(item) } : {};
    }
    if (command instanceof QueryCommand) {
      const input = command.input, values = input.ExpressionAttributeValues!;
      expect(input.ConsistentRead).toBe(true);
      expect(input.Limit).toBeLessThanOrEqual(50);
      expect(input.IndexName).toBeUndefined();
      expect(input.KeyConditionExpression).toBe(values[":upper"] ? "pk = :owner AND sk BETWEEN :prefix AND :upper" : "pk = :owner AND begins_with(sk, :prefix)");
      const all = [...records.values()].filter((r) => r.pk.S === values[":owner"]!.S && r.sk.S!.startsWith(values[":prefix"]!.S!) &&
        (!input.ExclusiveStartKey || r.sk.S! > input.ExclusiveStartKey.sk.S!) && (!values[":upper"] || r.sk.S! <= values[":upper"].S!))
        .sort((a, b) => a.sk.S! < b.sk.S! ? -1 : 1);
      // DynamoDB also ends pages at 1 MB regardless of Limit.
      let bytes = 0;
      const items = all.slice(0, input.Limit).filter((item) => { bytes += Buffer.byteLength(JSON.stringify(item)); return bytes <= 1024 * 1024; });
      const last = items.at(-1);
      const result = structuredClone({ Items: items, ...(all.length > items.length && last ? { LastEvaluatedKey: { pk: last.pk, sk: last.sk } } : {}) });
      const hook = faults.afterQuery; delete faults.afterQuery; await hook?.();
      return result;
    }
    await beforeWrite();
    if (command instanceof PutItemCommand) {
      if (!valid(command.input as Put)) throw Object.assign(new Error("private conditional error"), { name: "ConditionalCheckFailedException" });
      records.set(key(command.input.Item!), structuredClone(command.input.Item!));
      afterWrite(); return {};
    }
    if (command instanceof TransactWriteItemsCommand) {
      const actions = command.input.TransactItems!;
      expect(actions.length).toBeLessThanOrEqual(50);
      if (actions[0]?.Delete && faults.failPurge) { delete faults.failPurge; throw new Error("private purge failure"); }
      const checks = actions.map((a) => a.Put ? valid(a.Put) : true);
      if (checks.some((v) => !v)) throw Object.assign(new Error("private transaction error"), { name: "TransactionCanceledException",
        CancellationReasons: checks.map((v) => ({ Code: v ? "None" : "ConditionalCheckFailed" })) });
      for (const action of actions) {
        expect((action.Put ?? action.Delete)!.TableName).toBe("test-state");
        if (action.Put) {
          expect(Buffer.byteLength(JSON.stringify(action.Put.Item))).toBeLessThan(400 * 1024);
          records.set(key(action.Put.Item!), structuredClone(action.Put.Item!));
        } else if (action.Delete) records.delete(key(action.Delete.Key!));
        else throw new Error("Unexpected transaction action");
      }
      afterWrite(); return {};
    }
    throw new Error("Unexpected command");
  } };
  const clock = { now: () => new Date("2026-09-18T12:00:00.000Z") };
  return { records, commands, client, faults, clock,
    conversations: new DynamoDbConversationRepository("test-state", client, clock), profiles: new DynamoDbProfileRepository("test-state", client) };
}
