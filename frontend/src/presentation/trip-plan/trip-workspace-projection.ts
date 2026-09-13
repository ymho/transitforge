import { applyTripProposal, validateTrip, type Trip, type ItineraryItem, type TripUpdateProposal } from "@raiquora/trip/trip";
import { effectiveTripConstraints, type PlanAssumption } from "@raiquora/trip/trip-request";
import type { TripRequirement } from "@raiquora/trip/trip-requirement";
import { formatMoney } from "@raiquora/trip/money";
import { transportPreview } from "../../usecases/trip-plan/transport-preview";
import { accommodationPreview } from "../../usecases/trip-plan/accommodation-preview";
import { activityPreview } from "../../usecases/trip-plan/activity-preview";
import { itineraryScheduleLabel } from "../../usecases/trip-plan/itinerary-schedule-label";
import { tripPartyView } from "../../usecases/trip-plan/trip-party-presentation";
import { tripPlacesPreview } from "../../usecases/trip-plan/trip-places-preview";

export const assumptionFieldLabels = { schedule: "日時", place: "場所", selection: "採用内容" } as const;
export const planningLabels = { inspiration: "旅のイメージ", candidate_discovery: "候補を探す", candidate_selection: "候補を比較",
  itinerary_draft: "仮旅程", itinerary_refinement: "旅程を調整", ready: "計画の確認済み" } as const;
export const lifecycleLabels = { pre_trip: "旅行前", in_trip: "旅行中", completed: "旅行終了", cancelled: "中止" } as const;

export function itineraryItemCopy(item: ItineraryItem): string {
  return item.type === "transport" ? transportPreview(item) : item.type === "stay" ? accommodationPreview(item) : activityPreview(item);
}

/** Local date as authored, never browser time or request dates. Array order is preserved within each bucket. */
export function itineraryDay(item: ItineraryItem): string {
  const s = item.schedule;
  return s.type === "fixed" ? s.startAt.at.slice(0, 10) : s.type === "window" ? s.earliestStart.at.slice(0, 10)
    : s.type === "day" ? s.date : "日時未定";
}
export function itemAssumptions(trip: Trip, itemId: string): { field: string; text: string }[] {
  return trip.request.assumptions.filter((a) => a.status === "unconfirmed").flatMap((a) => a.affects.flatMap((r) =>
    r.type === "item" && r.itemId === itemId ? [{ field: assumptionFieldLabels[r.field], text: a.text }] : []));
}
export function assumptionTarget(a: PlanAssumption, trip: Trip): string {
  return a.affects.map((r) => r.type === "party" ? "今回の人数" : r.type === "constraint" ? `条件 ${r.constraintId}` :
    `${trip.items.find((i) => i.id === r.itemId)?.title ?? r.itemId}の${assumptionFieldLabels[r.field]}`).join(" / ");
}
export function tripWorkspaceProjection(trip: Trip) {
  validateTrip(trip);
  const days = new Map<string, ItineraryItem[]>();
  for (const item of trip.items) {
    const day = itineraryDay(item);
    if (!days.has(day)) days.set(day, []);
    days.get(day)!.push(item);
  }
  // Do not silently reorder a user's itinerary by date. Unscheduled is explicitly separate.
  const unscheduled = days.get("日時未定");
  if (unscheduled) { days.delete("日時未定"); days.set("日時未定", unscheduled); }
  return { title: trip.title, places: tripPlacesPreview(trip), party: tripPartyView(trip)?.text ?? "今回の人数は未確認",
    state: `${planningLabels[trip.planningState]} / ${lifecycleLabels[trip.lifecycleState]}`, days: [...days],
    assumptions: trip.request.assumptions.filter((a) => a.status === "unconfirmed").map((a) => ({ id: a.id, text: a.text, target: assumptionTarget(a, trip) })) };
}

/** Same Domain application as confirmation; a projection never commits its result. */
export function tripProposalProjection(trip: Trip, proposal: TripUpdateProposal) {
  const after = applyTripProposal(trip, proposal);
  const ids = new Set(proposal.patches.flatMap((p) => p.type === "add" ? [p.item.id] : "itemId" in p ? [p.itemId] : []));
  const describe = (t: Trip, id: string) => {
    const item = t.items.find((i) => i.id === id);
    return item ? `${item.title}\n${itineraryItemCopy(item)}\n行程順: ${t.items.indexOf(item) + 1}` : "この予定はありません";
  };
  return { summary: proposal.summary, changes: [...ids].map((id) => ({ id, before: describe(trip, id), after: describe(after, id) })),
    requestChanged: proposal.patches.some((p) => p.type === "request"),
    beforeConditions: requestCopy(trip), afterConditions: requestCopy(after),
    beforeState: `${planningLabels[trip.planningState]} / ${lifecycleLabels[trip.lifecycleState]}`,
    afterState: `${planningLabels[after.planningState]} / ${lifecycleLabels[after.lifecycleState]}` };
}
function requestCopy(trip: Trip): string {
  return [trip.request.goal, tripPartyView(trip)?.text,
    ...effectiveTripConstraints(trip.request).map((c) => {
      const scope = c.scope;
      return `${c.strength === "hard" ? "必須" : "希望"}: ${requirementCopy(c.requirement)}${scope.type === "item" ? `（${trip.items.find((i) => i.id === scope.itemId)?.title ?? scope.itemId}）` : ""}`;
    }),
    ...trip.request.assumptions.map((a) => `${a.status === "unconfirmed" ? "仮置き" : a.status === "confirmed" ? "確認済み" : "却下"}: ${a.text}`),
  ].filter(Boolean).join("\n") || "条件はまだありません";
}
function requirementCopy(r: TripRequirement): string {
  switch (r.type) {
    case "budget": return `予算 ${formatMoney(r.limit)} / ${r.basis === "trip" ? "旅行全体" : "1人"}`;
    case "origin": return `出発地 ${r.place.name}`;
    case "destinations": return `希望先 ${r.places.map((p) => p.name).join(" → ")}（${r.order === "fixed" ? "希望順" : "順不同"}）`;
    case "dates": return `出発 ${r.start.earliest}〜${r.start.latest}${r.end ? ` / 終了 ${r.end.earliest}〜${r.end.latest}` : ""}${r.timeZone ? ` / ${r.timeZone}` : ""}`;
    case "duration": return `期間 ${r.minimum}〜${r.maximum}${r.unit === "nights" ? "泊" : "日"}`;
    case "depart_after": case "arrive_by": return `${r.place.name} ${r.at.at} ${r.at.timeZone} ${r.type === "arrive_by" ? "までに到着" : "以降に出発"}`;
    case "experience": return `${r.intent === "avoid" ? "避ける" : r.intent === "must" ? "必ず体験" : "体験したい"}: ${r.text}`;
    case "pace": return `ペース ${r.value}（0: ゆっくり〜1: 活発）`;
    case "relative_distance": return `${r.comparedCandidateIds.join(" / ")}より${r.direction === "nearer" ? "近く" : "遠く"}`;
    case "adventure": return `冒険の強さ ${r.intensity} / 避けるリスク: ${r.avoidedRisks.join("・") || "指定なし"}`;
    case "mobility": return `移動条件 ${Object.entries(r).filter(([key]) => key !== "type").map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join("・") : value}`).join(" / ")}`;
  }
}
export { itineraryScheduleLabel };
