import { createHash } from "node:crypto";
import { DynamoDBClient, QueryCommand, type AttributeValue } from "@aws-sdk/client-dynamodb";
import { validateWatchSubject, watchSubjectKey, monitoringKey, type WatchSubject } from "@raiquora/trip/trip-watch";
import { requireTripPrincipal } from "../contracts/trip-principal.js";
import { TripResourceError, tripIdentifier } from "../contracts/trip-api.js";
import type { TripImpactRouter } from "../ports/trip-impact-routing.js";
import type { TripDynamoClient } from "./dynamodb-trip-repository.js";
import { DynamoDbTripWatchRepository, railWatchRoutingIndex, railWatchRoutingKey } from "./dynamodb-trip-watch-repository.js";

/** Subject-only internal GSI. Index hits are routing hints; no Trip/private payload is projected. */
export class DynamoDbTripImpactRouter implements TripImpactRouter {
  constructor(private readonly table: string, private readonly client: TripDynamoClient = new DynamoDBClient({})) {
    if (!table) throw new TripResourceError("unavailable");
  }
  async route(subject: WatchSubject) {
    validateWatchSubject(subject);
    const key = railWatchRoutingKey(subject), rows: Record<string, AttributeValue>[] = [], cursors = new Set<string>();
    let cursor: Record<string, AttributeValue> | undefined;
    do {
      let page;
      try { page = await this.client.send(new QueryCommand({ TableName: this.table, IndexName: railWatchRoutingIndex,
        KeyConditionExpression: "railSubject = :subject", ExpressionAttributeValues: { ":subject": { S: key } }, Limit: 100,
        ...(cursor ? { ExclusiveStartKey: cursor } : {}) })); }
      catch { throw new TripResourceError("unavailable"); }
      for (const row of page.Items ?? []) {
        if (row.railSubject?.S !== key || !row.pk?.S?.startsWith("OWNER#") || !/^WATCH#[0-9a-f-]{36}#[0-9a-f]{64}$/iu.test(row.sk?.S ?? "")) throw new TripResourceError("unavailable");
        rows.push(row);
      }
      if (rows.length > 10000) throw new TripResourceError("payload-too-large");
      cursor = page.LastEvaluatedKey;
      if (cursor) {
        const token = monitoringKey(cursor);
        if (cursor.railSubject?.S !== key || cursors.has(token) || cursors.size >= 100) throw new TripResourceError("unavailable");
        cursors.add(token);
      }
    } while (cursor);
    const watches = new DynamoDbTripWatchRepository(this.table, this.client);
    const routes: Awaited<ReturnType<TripImpactRouter["route"]>>["routes"] = [], seen = new Set<string>();
    let stale = 0;
    for (const row of rows) {
      const principal = { subject: row.pk!.S!.slice("OWNER#".length) }, tripId = row.sk!.S!.split("#")[1]!;
      requireTripPrincipal(principal); tripIdentifier(tripId);
      const identity = monitoringKey([principal.subject, tripId]);
      if (seen.has(identity)) continue;
      seen.add(identity);
      const base = await watches.read(principal, tripId);
      if (!base.complete || !base.records.some((r) => r.active && r.watch.sourceTripRevision === base.sourceTripRevision &&
          watchSubjectKey(r.watch.subject) === watchSubjectKey(subject) && rows.some((hint) => hint.pk?.S === row.pk?.S &&
            hint.sk?.S === `WATCH#${tripId}#${createHash("sha256").update(r.watch.id).digest("hex")}`))) { stale++; continue; }
      routes.push({ principal, tripId });
    }
    return { routes, stale };
  }
}
