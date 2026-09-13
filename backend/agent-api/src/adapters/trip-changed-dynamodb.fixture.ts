import { expect } from "vitest";
import { QueryCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";
import type { TripDynamoClient } from "./dynamodb-trip-repository.js";
import { watchDynamoFixture } from "./watch-dynamodb.fixture.js";
import { DynamoDbTripChangedOutbox } from "./dynamodb-trip-changed-outbox.js";

export function tripChangedFixture() {
  const base = watchDynamoFixture();
  let now = base.clock.now().getTime();
  const clock = { now: () => new Date(now) };
  const faults = { lostClaim: false, lostAck: false, failRead: false };
  const client: TripDynamoClient = { async send(c) {
    if (faults.failRead) throw new Error("private-provider-error");
    if (c instanceof QueryCommand && c.input.IndexName === "trip-changed-due") {
      base.commands.push(c); const v = c.input.ExpressionAttributeValues!;
      expect(c.input.KeyConditionExpression).toBe("outboxShard = :shard AND availableAt <= :now");
      return { Items: [...base.records.values()].filter((r) => r.outboxShard?.S === v[":shard"]!.S && Number(r.availableAt?.N) <= Number(v[":now"]!.N))
        .sort((a, b) => Number(a.availableAt?.N) - Number(b.availableAt?.N)).slice(0, c.input.Limit)
        .map((r) => ({ pk: r.pk!, sk: r.sk! })) };
    }
    if (c instanceof PutItemCommand && c.input.Item?.sk?.S?.startsWith("TRIP_CHANGED#")) {
      base.commands.push(c);
      const i = c.input, row = i.Item!, key = `${row.pk!.S}/${row.sk!.S}`, old = base.records.get(key), v = i.ExpressionAttributeValues;
      expect(i.ConditionExpression).toMatch(/deliveryVersion/);
      if (!old || v?.[":base"] && JSON.stringify(old.deliveryVersion) !== JSON.stringify(v[":base"]) ||
          !v && old.deliveryVersion !== undefined || v?.[":pending"] && old.deliveryState?.S !== "pending" ||
          v?.[":dead"] && old.deliveryState?.S !== "dead") {
        throw Object.assign(new Error("private-conflict"), { name: "ConditionalCheckFailedException" });
      }
      base.records.set(key, structuredClone(row));
      if (faults.lostClaim && row.deliveryState?.S === "pending") { faults.lostClaim = false; throw new Error("lost claim response"); }
      if (faults.lostAck && row.deliveryState?.S === "done") { faults.lostAck = false; throw new Error("lost ack response"); }
      return {};
    }
    return base.client.send(c);
  } };
  const outbox = new DynamoDbTripChangedOutbox("test-trips", client);
  return { ...base, client, outbox, deliveryFaults: faults, clock,
    advance(ms = 120_001) { now += ms; },
    deliveries() { return [...base.records.values()].filter((r) => r.sk?.S?.startsWith("TRIP_CHANGED#")); } };
}
