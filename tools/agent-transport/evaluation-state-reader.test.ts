import { expect, it, vi } from "vitest";
import { GetItemCommand, type DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { createHash } from "node:crypto";
import { createEvaluationStateReader } from "./evaluation-state-reader.js";

const target = { tripId: "11111111-1111-4111-8111-111111111111", conversationId: "11111111-1111-4111-8111-111111111111",
  turnId: "22222222-2222-4222-8222-222222222222" };
const config = { issuer: "test-issuer", subject: "dedicated-test-user", stateTable: "test-state", tripTable: "test-trips" };
const pk = "OWNER#identity-v1:" + createHash("sha256").update(JSON.stringify([config.issuer, config.subject])).digest("hex");

it("reads exact owner keys and projects only relevant state, omitting raw response and evidence", async () => {
  const working = { version: 1, revision: 0, sourceTurnId: target.turnId, sourceUserSequence: 1,
    target: { conversationId: target.conversationId, tripId: target.tripId, tripRevision: 0 }, presentations: [], pendingQuestionRefs: ["q-1"], pendingProposalRefs: [] };
  const send = vi.fn(async (command: GetItemCommand) => {
    expect(command).toBeInstanceOf(GetItemCommand); expect(command.input.ConsistentRead).toBe(true);
    expect(command.input.Key?.pk?.S).toBe(pk); expect(command.input.TableName).toBe("test-state");
    const key = command.input.Key!.sk!.S!;
    expect([`TRIP_WORKING#${target.conversationId}`, `TRIP_TURN#${target.conversationId}#${target.turnId}`]).toContain(key);
    const payload = key.startsWith("TRIP_WORKING") ? working : { state: "failed", userSequence: 1, result: { response: "raw-private-text" }, attemptId: "not-output" };
    return { Item: { pk: { S: pk }, sk: { S: key }, storageVersion: { N: "1" }, revision: { N: "0" }, deleted: { BOOL: false }, payload: { S: JSON.stringify(payload) } } };
  });
  const read = createEvaluationStateReader(config, { send } as unknown as Pick<DynamoDBClient, "send">);
  const value = await read(target);
  expect(value).toMatchObject({ working: { pendingQuestionRefs: ["q-1"] }, turn: { state: "failed", userSequence: 1 }, candidates: [] });
  expect(JSON.stringify(value)).not.toContain("raw-private-text"); expect(JSON.stringify(value)).not.toContain("not-output");
  expect(send).toHaveBeenCalledTimes(2);
});

it("rejects foreign returned keys and an unrelated Trip target without scanning", async () => {
  const send = vi.fn(async () => ({ Item: { pk: { S: "OWNER#other" }, sk: { S: `TRIP_WORKING#${target.conversationId}` },
    storageVersion: { N: "1" }, revision: { N: "0" }, deleted: { BOOL: false }, payload: { S: "{}" } } }));
  const read = createEvaluationStateReader(config, { send } as unknown as Pick<DynamoDBClient, "send">);
  await expect(read(target)).rejects.toThrow();
  const before = send.mock.calls.length;
  await expect(read({ ...target, tripId: target.turnId })).rejects.toThrow("invalid_evaluation_state_target");
  expect(send).toHaveBeenCalledTimes(before);
});
