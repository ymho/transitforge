import { describe, expect, it } from "vitest";
import { GetItemCommand, PutItemCommand, UpdateItemCommand, DeleteItemCommand, QueryCommand, type AttributeValue } from "@aws-sdk/client-dynamodb";
import { createTrip } from "@raiquora/trip/trip";
import { railSelectionFixture } from "../../../../modules/trip/domain/selected-rail-journey.fixture";
import { selectRailJourney, projectRailSchedule, revalidateSelectedRailJourney } from "@raiquora/trip/selected-rail-journey";
import { DynamoDbTripRepository, type TripDynamoClient } from "./dynamodb-trip-repository.js";
import { TripApplication } from "../usecases/trip-application.js";

const a = { subject: "owner-A" }, b = { subject: "owner-B" };
const id = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const trip = () => createTrip(id, "旅行", "2026-09-13T01:00:00Z");
/** SDK command contract fake, not a live DynamoDB integration claim. */
function fixture() {
  const records = new Map<string, Record<string, AttributeValue>>(), commands: unknown[] = [];
  const key = (item: Record<string, AttributeValue>) => `${item.pk!.S}/${item.sk!.S}`;
  const conditional = () => { const error = new Error("sensitive SDK detail"); error.name = "ConditionalCheckFailedException"; throw error; };
  const client: TripDynamoClient = { async send(command) {
    commands.push(command);
    if (command instanceof QueryCommand) {
      const i = command.input;
      expect(i.KeyConditionExpression).toBe("pk = :owner AND begins_with(sk, :prefix)");
      const pk = i.ExpressionAttributeValues![":owner"]!.S, after = i.ExclusiveStartKey?.sk?.S;
      const items = [...records.values()].filter((r) => r.pk?.S === pk && r.sk?.S?.startsWith("TRIP#") && (!after || r.sk.S > after)).sort((a, b) => a.sk!.S!.localeCompare(b.sk!.S!));
      const page = items.slice(0, i.Limit);
      return { Items: structuredClone(page), ...(items.length > page.length ? { LastEvaluatedKey: { pk: page.at(-1)!.pk!, sk: page.at(-1)!.sk! } } : {}) };
    }
    if (command instanceof PutItemCommand) {
      const i = command.input, k = key(i.Item!);
      if (i.ConditionExpression && records.has(k)) conditional();
      records.set(k, structuredClone(i.Item!)); return {};
    }
    const i = command.input, k = key(i.Key!);
    if (command instanceof GetItemCommand) return records.has(k) ? { Item: structuredClone(records.get(k)!) } : {};
    if (command instanceof DeleteItemCommand) { expect(i.Key!.sk!.S).toMatch(/^CONVERSATION#/); records.delete(k); return {}; }
    if (command instanceof UpdateItemCommand) {
      const record = records.get(k);
      expect(command.input.ConditionExpression).toBe("attribute_exists(pk) AND archived = :active");
      if (!record || record.archived?.BOOL !== false) conditional();
      const values = command.input.ExpressionAttributeValues!;
      if (values[":trip"]) record!.trip = values[":trip"];
      else record!.archived = values[":archived"]!;
      return {};
    }
    throw new Error("Unexpected command");
  } };
  const repository = new DynamoDbTripRepository("test-trips", client);
  return { repository, records, commands, application: new TripApplication(repository, repository) };
}

describe("owner-scoped Trip storage", () => {
  it("persists a complete scheduled rail snapshot without leaking candidate realtime fields", async () => {
    const f = fixture(), { candidate, inputs, selectedAt } = railSelectionFixture();
    const journey = selectRailJourney(candidate, inputs, selectedAt);
    const input = createTrip(id, "鉄道の旅", "2026-09-13T01:00:00Z", [{ id: "rail", type: "transport", title: "移動", schedule: projectRailSchedule(journey), detail: { mode: "rail", status: "selected", journey } }]);
    await f.repository.create(a, input);
    const loaded = await f.repository.get(a, id);
    expect(loaded).toEqual(input);
    expect(JSON.stringify(loaded)).not.toMatch(/delayMinutes|congestion|realtimeStatus/);
    inputs[0]!.evidence.retrievedAt = "2026-09-14T08:00:00Z";
    expect(revalidateSelectedRailJourney(journey, inputs)).toBe(true);
    const invalid = structuredClone(input);
    Object.assign(invalid.items[0]!, { rawProvider: { delayMinutes: 10 } });
    await expect(f.repository.replace(a, invalid)).rejects.toMatchObject({ code: "invalid-input" });
    expect(await f.repository.get(a, id)).toEqual(input);
  });
  it("round trips schema/revision, copies input and replaces only an existing active resource", async () => {
    const f = fixture(), input = trip();
    expect(await f.repository.create(a, input)).toEqual(input);
    expect(await f.repository.get(a, id)).toEqual(input);
    await expect(f.repository.create(a, input)).rejects.toMatchObject({ code: "already-exists" });
    const replacement = { ...input, title: "変更", revision: 8 };
    await f.repository.replace(a, replacement);
    expect(await f.repository.get(a, id)).toEqual(replacement);
    expect(input).toEqual(trip());
    await expect(f.repository.replace(a, { ...replacement, id: other })).rejects.toMatchObject({ code: "not-found" });
    await expect(f.repository.replace(a, { ...replacement, createdAt: "2026-09-12T01:00:00Z" })).rejects.toMatchObject({ code: "invalid-input" });
  });
  it("scopes reads, lists, replace, archive and link references to owner keys", async () => {
    const f = fixture(); await f.repository.create(a, trip());
    expect(await f.repository.get(b, id)).toBeUndefined();
    expect((await f.repository.list(b)).trips).toEqual([]);
    expect((await f.repository.list(a)).trips).toHaveLength(1);
    await expect(f.repository.replace(b, trip())).rejects.toMatchObject({ code: "not-found" });
    await expect(f.repository.archive(b, id)).rejects.toMatchObject({ code: "not-found" });
    await expect(f.repository.attach(b, "session", id)).rejects.toMatchObject({ code: "not-found" });
    await f.repository.create(b, trip()); // Same opaque Trip ID in another owner namespace remains isolated.
    await f.repository.archive(b, id);
    expect(await f.repository.get(a, id)).toBeDefined();
  });
  it("archive preserves Trip data and links, hides reads/lists, and never revives via replace", async () => {
    const f = fixture(); await f.repository.create(a, trip());
    await f.repository.attach(a, "first", id); await f.repository.attach(a, "second", id);
    expect(await f.repository.reference(b, "first")).toBeUndefined();
    await f.repository.detach(a, "first");
    expect(await f.repository.get(a, id)).toBeDefined();
    await f.repository.archive(a, id);
    expect(await f.repository.get(a, id)).toBeUndefined(); expect((await f.repository.list(a)).trips).toEqual([]);
    expect(await f.repository.reference(a, "second")).toBe(id);
    expect(f.records.get(`OWNER#owner-A/TRIP#${id}`)?.trip?.S).toContain('"schemaVersion":2');
    await expect(f.repository.replace(a, trip())).rejects.toMatchObject({ code: "not-found" });
  });
  it("paginates within the owner even across an archived page", async () => {
    const f = fixture(); await f.repository.create(a, trip()); await f.repository.create(a, { ...trip(), id: other });
    await f.repository.archive(a, id);
    const first = await f.repository.list(a, { limit: 1 });
    expect(first).toEqual({ trips: [], nextAfterTripId: id });
    expect((await f.repository.list(a, { afterTripId: first.nextAfterTripId, limit: 1 })).trips[0]?.id).toBe(other);
  });
  it("requires principal on every repository operation before issuing commands", async () => {
    const f = fixture(), missing = undefined as never;
    for (const promise of [f.repository.create(missing, trip()), f.repository.get(missing, id), f.repository.list(missing), f.repository.replace(missing, trip()), f.repository.archive(missing, id), f.repository.attach(missing, "s", id), f.repository.detach(missing, "s"), f.repository.reference(missing, "s")]) await expect(promise).rejects.toMatchObject({ code: "unauthenticated" });
    expect(f.commands).toEqual([]);
  });
  it("rejects invalid Domain, raw payload and forged request owner without writes", async () => {
    const f = fixture();
    for (const input of [{ ...trip(), schemaVersion: 1 }, { ...trip(), candidates: [] }, { ...trip(), items: [{ id: "bad", type: "unknown" }] }]) await expect(f.repository.create(a, input as never)).rejects.toMatchObject({ code: "invalid-input" });
    await expect(f.application.execute(a, { version: "trip-api-v1", operation: "create", trip: trip(), ownerId: "owner-B" })).rejects.toMatchObject({ code: "invalid-input" });
    expect(f.commands).toEqual([]);
  });
  it("Application maps cross-owner to the same not-found as an unknown resource", async () => {
    const f = fixture(); await f.repository.create(a, trip());
    for (const tripId of [id, other]) await expect(f.application.execute(b, { version: "trip-api-v1", operation: "get", tripId })).rejects.toMatchObject({ code: "not-found" });
  });
  it("does not expose SDK errors or accept corrupt storage as a normal Trip", async () => {
    const repository = new DynamoDbTripRepository("t", { send: async () => { throw new Error("private-party-and-token"); } });
    await expect(repository.get(a, id)).rejects.toMatchObject({ message: "unavailable" });
    const f = fixture(); await f.repository.create(a, trip());
    f.records.get(`OWNER#owner-A/TRIP#${id}`)!.storageVersion = { N: "999" };
    await expect(f.repository.get(a, id)).rejects.toMatchObject({ code: "unavailable" });
  });
});
