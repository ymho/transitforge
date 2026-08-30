import { travelRecheckDifference, type TravelRecheckRequest, type TravelRecheckSnapshot } from "@raiquora/trip/travel-recheck";
interface StoredRecheck { request: TravelRecheckRequest; previous?: TravelRecheckSnapshot; latest?: TravelRecheckSnapshot; attempts: number }
interface RecheckRepository { due(now?: Date): StoredRecheck[]; record(id: string, latest: TravelRecheckSnapshot): void }
interface RecheckDependencies { weather(location: string): Promise<{ forecast: { status: TravelRecheckSnapshot["status"]; data?: unknown; evidence: TravelRecheckSnapshot["evidence"] } }>; railOperation?(serviceDate: string): Promise<{ data: unknown; evidence: TravelRecheckSnapshot["evidence"] }> }

export async function runDueTravelRechecks(repository: RecheckRepository, dependencies: RecheckDependencies, now = new Date()): Promise<string[]> {
  const notices: string[] = [];
  for (const item of repository.due(now)) {
    const latest = await recheck(item, dependencies, now);
    repository.record(item.request.id, latest);
    const difference = travelRecheckDifference(item.latest, latest);
    notices.push(difference.severity === "none" ? `${item.request.entityId}の${label(item.request.kind)}を再確認しました。前回から大きな変更はありません。` : latest.status === "available" ? `${item.request.entityId}の${label(item.request.kind)}を再確認しました。前回から変更があります。会話で最新の候補を確認できます。` : `${item.request.entityId}の${label(item.request.kind)}を再確認できませんでした。古い情報を最新として扱っていません。`);
  }
  return notices;
}
async function recheck(item: StoredRecheck, dependencies: RecheckDependencies, now: Date): Promise<TravelRecheckSnapshot> {
  try {
    if (item.request.kind === "weather") return snapshot((await dependencies.weather(item.request.entityId)).forecast, now);
    if (item.request.kind === "rail-operation" && dependencies.railOperation) { const result = await dependencies.railOperation(item.request.entityId); return snapshot({ status: "available", ...result }, now); }
  } catch { /* unavailable below */ }
  return { checkedAt: now.toISOString(), status: "unavailable", evidence: [] };
}
function snapshot(information: { status: TravelRecheckSnapshot["status"]; data?: unknown; evidence: TravelRecheckSnapshot["evidence"] }, now: Date): TravelRecheckSnapshot { return { checkedAt: now.toISOString(), status: information.status, ...(information.data === undefined ? {} : { fingerprint: stableFingerprint(information.data) }), evidence: information.evidence.slice(0, 8) }; }
function stableFingerprint(value: unknown): string { const text = JSON.stringify(value); let hash = 2166136261; for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619); return (hash >>> 0).toString(16); }
function label(kind: StoredRecheck["request"]["kind"]): string { return ({ weather: "天気", "rail-operation": "鉄道運行", "place-hours": "営業時間" })[kind]; }
