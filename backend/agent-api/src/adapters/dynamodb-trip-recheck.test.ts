import { describe, expect, it } from "vitest";
import { recheckDynamoFixture } from "./recheck-dynamodb.fixture.js";
import { recheckIdentity, recheckPolicyVersion } from "@raiquora/trip/trip-recheck";
import { validateRecheckTask } from "../contracts/trip-recheck.js";
import { recheckDelivery } from "../ports/trip-recheck.js";

const owner = { subject: "owner-A" }, now = Date.parse("2026-09-12T08:00:00Z");
const tripId = "11111111-1111-4111-8111-111111111111";
const task = { id: recheckIdentity(tripId, 1, "readiness"), tripId, sourceTripRevision: 1, kind: "readiness", policyVersion: recheckPolicyVersion, dueAt: now } as const;
describe("durable recheck task delivery", () => {
  it("duplicate ensure does not reset delivery; owner namespaces are isolated", async () => {
    const f = recheckDynamoFixture(); await f.repository.ensure(owner, task); await f.repository.ensure(owner, task);
    const key = (await f.repository.due(now))[0]!, first = (await f.repository.claim(key, now))!;
    await f.repository.ensure(owner, task); expect(await f.repository.claim(key, now)).toBeUndefined();
    await f.repository.ensure({ subject: "owner-B" }, task); expect(f.rows.size).toBe(2);
    await f.repository.finish(first, { state: "inactive" }); await f.repository.ensure(owner, task);
    expect(await f.repository.claim(key, now + 1_000_000)).toBeUndefined();
  });
  it("crash after claim expires lease; late worker cannot ACK newer claim", async () => {
    const f = recheckDynamoFixture(); await f.repository.ensure(owner, task);
    const key = (await f.repository.due(now))[0]!, first = (await f.repository.claim(key, now))!;
    expect(await f.repository.due(now)).toEqual([]);
    const second = (await f.repository.claim(key, now + recheckDelivery.leaseMs))!;
    expect(second.attempt).toBe(2);
    await expect(f.repository.finish(first, { state: "inactive" })).rejects.toThrow();
    await f.repository.finish(second, { state: "inactive" });
  });
  it("lost create/claim/finish responses preserve durable progress", async () => {
    const f = recheckDynamoFixture(); f.faults.lostResponse = true;
    await expect(f.repository.ensure(owner, task)).rejects.toThrow(); await f.repository.ensure(owner, task);
    const key = (await f.repository.due(now))[0]!; f.faults.lostResponse = true;
    await expect(f.repository.claim(key, now)).rejects.toThrow();
    const claim = (await f.repository.claim(key, now + recheckDelivery.leaseMs))!;
    f.faults.lostResponse = true; await expect(f.repository.finish(claim, { state: "inactive" })).rejects.toThrow();
    expect(await f.repository.claim(key, now + recheckDelivery.leaseMs * 2)).toBeUndefined();
  });
  it("dead records remain queryable; operator redrive is CAS guarded", async () => {
    const f = recheckDynamoFixture(); await f.repository.ensure(owner, task);
    const key = (await f.repository.due(now))[0]!, claim = (await f.repository.claim(key, now))!;
    await f.repository.finish(claim, { state: "dead" }); expect(await f.repository.due(now + 1_000_000)).toEqual([]);
    await expect(f.repository.redrive(key, claim.version - 1, now)).rejects.toThrow();
    await f.repository.redrive(key, claim.version, now);
    expect((await f.repository.claim(key, now))!.attempt).toBe(1);
  });
  it("rejects forged owner in task and quarantines corrupt stored task without copying payload", async () => {
    expect(() => validateRecheckTask({ ...task, ownerSubject: "victim" } as never)).toThrow();
    const f = recheckDynamoFixture(); await f.repository.ensure(owner, task);
    const row = [...f.rows.values()][0]!; row.task = { S: JSON.stringify({ ...task, ownerSubject: "victim", private: "secret" }) };
    const key = (await f.repository.due(now))[0]!, claim = (await f.repository.claim(key, now))!;
    expect(claim.task).toBeUndefined(); await f.repository.finish(claim, { state: "dead" });
    expect(JSON.stringify([...f.rows.values()])).not.toContain("secret");
    await expect(f.repository.redrive(key, claim.version, now)).rejects.toThrow();
  });
  it("old GSI hint is checked on base record; bounded query uses no Scan", async () => {
    const f = recheckDynamoFixture(); await f.repository.ensure(owner, task);
    const key = (await f.repository.due(now))[0]!, claim = (await f.repository.claim(key, now))!;
    f.faults.hints = [...f.rows.values()]; await f.repository.finish(claim, { state: "dead" });
    expect(await f.repository.claim((await f.repository.due(now))[0]!, now)).toBeUndefined();
    expect(f.commands.some((c) => c?.constructor?.name === "ScanCommand")).toBe(false);
  });
});
