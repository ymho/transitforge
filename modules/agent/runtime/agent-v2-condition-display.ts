import type { IntentTarget, IntentValue } from "@raiquora/trip/conversation-intent";
import type { EffectiveIntent } from "./effective-intent";
import type { PublicSemanticReceipt } from "./public-semantic-receipt";

const labels: Partial<Record<IntentTarget, string>> = { origin: "出発地", destination: "行き先", party_size: "全体人数",
  start_date: "出発日", end_date: "終了日", duration: "期間", budget: "予算" };
/** Display only values joined to receipts returned by this invocation's authenticated
 * condition controller. No model text, Profile hints, raw IDs or new state store.
 * A replay receipt that no longer describes the current value is not shown as current. */
export function conditionDisplayLines(receipts: readonly PublicSemanticReceipt[], intent?: EffectiveIntent): string[] {
  if (!intent) return [];
  const targets = new Set<IntentTarget>();
  const lines: string[] = [];
  for (const receipt of receipts) for (const change of receipt.changes) {
    if (change.status !== "accepted" || change.frame !== "actual" || change.scope.type !== "conversation" ||
        targets.has(change.target) || !labels[change.target] || receipt.intentRevision > intent.intentRevision) continue;
    const fact = intent.actualConversationFacts.find(f => f.target === change.target && f.sourceOperationId === change.changeRef &&
      f.frame === "actual" && f.scope.type === "conversation");
    const retracted = intent.retractions.some(f => f.target === change.target && f.sourceOperationId === change.changeRef &&
      f.frame === "actual" && f.scope.type === "conversation");
    if (!fact && !retracted) continue;
    targets.add(change.target);
    const value = fact ? displayValue(fact.value) : "未定";
    if (value) lines.push(`${labels[change.target]}：${value}${fact?.precision === "approximate" ? "（目安）" : ""}`);
  }
  return lines;
}
function displayValue(value: IntentValue): string | undefined {
  switch (value.kind) {
    case "place_label": return value.label;
    case "local_date": return value.date;
    case "quantity": return `${value.amount}${{ people: "人", days: "日", nights: "泊" }[value.unit]}`;
    case "party": return `大人${value.adults}人・子ども${value.children.length}人`;
    case "money": return `${value.amount} ${value.currency ?? "（通貨未確認）"}／${value.basis === "trip" ? "旅行全体" : value.basis === "per_person" ? "1人あたり" : "単位未確認"}`;
    case "unknown": return "未確認";
    default: return undefined;
  }
}
