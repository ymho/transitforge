import { expect } from "vitest";
import { GetItemCommand, PutItemCommand, QueryCommand, TransactWriteItemsCommand, type AttributeValue, type Put, type TransactWriteItem } from "@aws-sdk/client-dynamodb";
import type { TripDynamoClient } from "./dynamodb-trip-repository.js";
import type { StateDynamoClient } from "./dynamodb-state-store.js";
type Item = Record<string, AttributeValue>;

/** Exact-expression transaction fake for the two existing tables. Not a live AWS emulator.
 * All conditions are checked against one pre-write image before ANY row changes. */
export function tripConsultationDynamoFixture() {
  const rows = new Map<string, Item>(), commands: unknown[] = [];
  const key = (table: string, item: Item) => `${table}/${item.pk!.S}/${item.sk!.S}`;
  const faults: { beforeCommit?: () => void; loseResponse?: boolean } = {};
  const validPut = (put: Put) => {
    const previous = rows.get(key(put.TableName!, put.Item!));
    if (put.ConditionExpression === "attribute_not_exists(pk)") return !previous;
    expect(put.ConditionExpression).toBe("revision = :base AND deleted = :deleted");
    return !!previous && previous.revision?.N === put.ExpressionAttributeValues![":base"]!.N && previous.deleted?.BOOL === put.ExpressionAttributeValues![":deleted"]!.BOOL;
  };
  const valid = (action: TransactWriteItem) => {
    if (action.Put) return validPut(action.Put);
    if (action.Delete) return true;
    if (action.ConditionCheck) {
      const check = action.ConditionCheck, current = rows.get(key(check.TableName!, check.Key!)), values = check.ExpressionAttributeValues!;
      if (check.ConditionExpression === "attribute_exists(pk) AND archived = :active AND revision = :revision") {
        return !!current && current.archived?.BOOL === values[":active"]!.BOOL && current.revision?.N === values[":revision"]!.N;
      }
      expect(check.ConditionExpression).toBe("attribute_exists(pk) AND deleted = :deleted AND revision = :revision");
      return !!current && current.deleted?.BOOL === values[":deleted"]!.BOOL && current.revision?.N === values[":revision"]!.N;
    }
    const update = action.Update!, current = rows.get(key(update.TableName!, update.Key!)), values = update.ExpressionAttributeValues!;
    expect(update.ConditionExpression).toBe("attribute_exists(pk) AND archived = :active AND (revision = :base OR (attribute_not_exists(revision) AND trip = :old))");
    expect(update.UpdateExpression).toBe("SET trip = :trip, revision = :next");
    return !!current && !current.archived.BOOL && current.revision.N === values[":base"].N;
  };
  const client: TripDynamoClient & StateDynamoClient = { async send(command) {
    commands.push(command);
    if (command instanceof GetItemCommand) {
      expect(command.input.ConsistentRead).toBe(true);
      const row = rows.get(key(command.input.TableName!, command.input.Key!)); return row ? { Item: structuredClone(row) } : {};
    }
    if (command instanceof QueryCommand) {
      const { TableName, ExpressionAttributeValues: values, ExclusiveStartKey, Limit } = command.input;
      expect(command.input.ConsistentRead).toBe(true);
      const items = [...rows.entries()].filter(([id, row]) => id.startsWith(`${TableName}/`) && row.pk.S === values![":owner"]!.S &&
        row.sk.S!.startsWith(values![":prefix"]!.S!) && (!ExclusiveStartKey || row.sk.S! > ExclusiveStartKey.sk.S!) &&
        (!values![":upper"] || row.sk.S! <= values![":upper"]!.S!)).map(([, row]) => row).sort((a,b) => a.sk.S!.localeCompare(b.sk.S!));
      const page = items.slice(0, Limit);
      return { Items: structuredClone(page), ...(items.length > page.length ? { LastEvaluatedKey: { pk: page.at(-1)!.pk, sk: page.at(-1)!.sk } } : {}) };
    }
    const actions = command instanceof PutItemCommand ? [{ Put: command.input }] : command instanceof TransactWriteItemsCommand ? command.input.TransactItems! : undefined;
    if (!actions) throw new Error("Unexpected SDK command");
    const checks = actions.map(valid);
    if (checks.some(value => !value)) throw Object.assign(new Error("conditional failure"), { name: "TransactionCanceledException",
      CancellationReasons: checks.map(value => ({ Code: value ? "None" : "ConditionalCheckFailed" })) });
    const before = faults.beforeCommit; delete faults.beforeCommit; before?.();
    for (const action of actions) {
      if (action.Put) rows.set(key(action.Put.TableName!, action.Put.Item!), structuredClone(action.Put.Item!));
      else if (action.Delete) rows.delete(key(action.Delete.TableName!, action.Delete.Key!));
      else if (action.ConditionCheck) continue;
      else {
        const update = action.Update!, row = rows.get(key(update.TableName!, update.Key!))!;
        row.trip = structuredClone(update.ExpressionAttributeValues![":trip"]!); row.revision = structuredClone(update.ExpressionAttributeValues![":next"]!);
      }
    }
    if (faults.loseResponse) { delete faults.loseResponse; throw new Error("response lost after commit"); }
    return {};
  } };
  return { rows, commands, faults, client, key, clock: { now: () => new Date("2026-09-27T12:00:00.000Z") } };
}
