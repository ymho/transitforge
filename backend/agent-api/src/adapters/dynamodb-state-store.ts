import { DynamoDBClient, GetItemCommand, PutItemCommand, QueryCommand, TransactWriteItemsCommand, type AttributeValue, type Put } from "@aws-sdk/client-dynamodb";
import { StateError, requireStatePrincipal, revision } from "../contracts/server-state.js";
import type { TrustedPrincipal } from "../contracts/trusted-principal.js";

export type StateItem = Record<string, AttributeValue>;
export type StateCommand = GetItemCommand | PutItemCommand | QueryCommand | TransactWriteItemsCommand;
export interface StateDynamoClient {
  send(command: StateCommand): Promise<{ Item?: StateItem; Items?: StateItem[]; LastEvaluatedKey?: StateItem }>;
}
export interface StateEnvelope { revision: number; deleted: boolean; payload?: unknown }

/** SDK plumbing only; no transport, runtime, logging, scans or cross-owner indexes. */
export class DynamoStateStore {
  constructor(readonly table: string, readonly client: StateDynamoClient = new DynamoDBClient({})) {
    if (!table) throw new StateError("unavailable");
  }
  owner(principal: TrustedPrincipal): string {
    requireStatePrincipal(principal);
    return `OWNER#${principal.subject}`;
  }
  key(principal: TrustedPrincipal, sk: string): StateItem { return { pk: { S: this.owner(principal) }, sk: { S: sk } }; }
  async send(command: StateCommand) {
    try { return await this.client.send(command); }
    catch (error) {
      const failure = error as { name?: string; CancellationReasons?: { Code?: string }[] };
      if (failure?.name === "ConditionalCheckFailedException" || failure?.name === "TransactionCanceledException" &&
        failure.CancellationReasons?.some((r) => r.Code === "ConditionalCheckFailed")) throw new StateError("conflict");
      throw new StateError("unavailable");
    }
  }
  decode(item: StateItem, pk: string, sk: string): StateEnvelope {
    try {
      if (item.pk?.S !== pk || item.sk?.S !== sk || item.storageVersion?.N !== "1" || typeof item.deleted?.BOOL !== "boolean") throw new Error();
      const version = Number(item.revision?.N);
      revision(version);
      if (item.revision?.N !== String(version) || item.deleted.BOOL && item.payload !== undefined || !item.deleted.BOOL && typeof item.payload?.S !== "string") throw new Error();
      return { revision: version, deleted: item.deleted.BOOL, ...(item.payload?.S ? { payload: JSON.parse(item.payload.S) } : {}) };
    } catch { throw new StateError("unavailable"); }
  }
  async read(principal: TrustedPrincipal, sk: string): Promise<StateEnvelope | undefined> {
    const key = this.key(principal, sk);
    const result = await this.send(new GetItemCommand({ TableName: this.table, Key: key, ConsistentRead: true }));
    return result.Item ? this.decode(result.Item, key.pk.S!, sk) : undefined;
  }
  put(principal: TrustedPrincipal, sk: string, next: StateEnvelope, old?: StateEnvelope): Put {
    revision(next.revision);
    return { TableName: this.table, Item: { ...this.key(principal, sk), storageVersion: { N: "1" },
      revision: { N: String(next.revision) }, deleted: { BOOL: next.deleted },
      ...(next.deleted ? {} : { payload: { S: JSON.stringify(next.payload) } }) },
      ConditionExpression: old ? "revision = :base AND deleted = :deleted" : "attribute_not_exists(pk)",
      ...(old ? { ExpressionAttributeValues: { ":base": { N: String(old.revision) }, ":deleted": { BOOL: old.deleted } } } : {}) };
  }
  async query(principal: TrustedPrincipal, prefix: string, limit: number, after?: string, upper?: string) {
    const pk = this.owner(principal);
    const result = await this.send(new QueryCommand({ TableName: this.table, ConsistentRead: true, Limit: limit,
      KeyConditionExpression: upper ? "pk = :owner AND sk BETWEEN :prefix AND :upper" : "pk = :owner AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: { ":owner": { S: pk }, ":prefix": { S: prefix }, ...(upper ? { ":upper": { S: upper } } : {}) },
      ...(after ? { ExclusiveStartKey: this.key(principal, after) } : {}) }));
    const items = result.Items ?? [];
    for (const item of [...items, ...(result.LastEvaluatedKey ? [result.LastEvaluatedKey] : [])]) {
      if (item.pk?.S !== pk || !item.sk?.S?.startsWith(prefix) || after && item.sk.S <= after || upper && item.sk.S > upper) throw new StateError("unavailable");
    }
    return { items, next: result.LastEvaluatedKey?.sk?.S };
  }
  /** Each bounded purge transaction is atomic; retries safely delete already absent items. */
  async purge(principal: TrustedPrincipal, keys: string[]) {
    if (!keys.length) return;
    await this.send(new TransactWriteItemsCommand({ TransactItems: keys.map((sk) => ({ Delete: {
      TableName: this.table, Key: this.key(principal, sk),
    } })) }));
  }
}
