import { tripCalendarDates } from "./trip-calendar-dates";
import type { Trip, ItineraryItem } from "@raiquora/trip/trip";
import { projectDailyItinerary } from "@raiquora/trip/daily-itinerary";

export interface TripConsultationTopic {
  readonly label: string;
  readonly context?: string;
  readonly prompt: string;
  readonly itemId?: string;
  readonly section: "undecided" | "review";
}

/** A few varied examples, with unresolved decisions ahead of reviewing saved choices. */
export function tripConsultationExamples(trip: Trip): TripConsultationTopic[] {
  const topics = tripConsultationTopics(trip).sort((a, b) => Number(a.section === "review") - Number(b.section === "review"));
  const examples: TripConsultationTopic[] = [];
  for (const topic of topics) {
    if (!examples.some(example => topic.itemId ? example.itemId === topic.itemId : example.label === topic.label)) examples.push(topic);
    if (examples.length === 3) return examples;
  }
  for (const topic of topics) {
    if (!examples.includes(topic)) examples.push(topic);
    if (examples.length === 3) break;
  }
  return examples;
}

/** Read-only suggestions from saved facts; never creates a place, time or booking. */
export function tripConsultationTopics(trip: Trip): TripConsultationTopic[] {
  const result: TripConsultationTopic[] = [];
  const projection = projectDailyItinerary(trip, { limit: 90 });
  const add = (item: ItineraryItem, label: string, intent: string, section: TripConsultationTopic["section"] = "undecided") => {
    const day = projection.days.find(day => day.entries.some(entry => entry.sourceItemId === item.id));
    const date = day?.localDate ?? (day?.logicalDayId ? tripCalendarDates(trip).get(day.logicalDayId) : undefined);
    const position = trip.items.findIndex(value => value.id === item.id) + 1;
    result.push({ label, context: `${date ?? "日付未定"}・${position}番目`, itemId: item.id, section,
      prompt: `相談対象：旅程「${trip.title}」の${position}番目の予定「${item.title}」${date ? `（${date}）` : ""}。\n${intent}` });
  };
  for (const item of trip.items) {
    if (item.type === "transport") {
      if (item.detail.status === "unresolved") add(item, `${item.title}：${item.detail.mode === "rail" ? "列車" : "交通手段"}を決める`, "この移動予定の交通手段・経路を決めたい");
      else if (item.detail.mode === "rail" || item.detail.provenance.type === "provider") add(item, `${item.title}：経路を選び直す`, "この移動予定の経路全体を再検索して選び直したい。新しい経路を採用するまで元の経路を残し、変更をやめたら元の経路のままにしてください。ほかの予定は変更しないでください", "review");
      else if (item.schedule.type !== "fixed") add(item, `${item.title}：移動時刻を決める`, "この移動予定の時刻を相談して決めたい");
    } else if (item.type === "stay") {
      if (item.selection.status === "unselected") add(item, `${item.title}：宿泊先を決める`, "この宿泊予定の宿泊先を相談して決めたい");
      else {
        if (!item.plannedTiming?.checkIn) add(item, `${item.title}：チェックイン時刻を決める`, "前後の予定を踏まえて、この宿泊予定のチェックイン時刻を決めたい。施設の受付時間と自分の到着予定を区別してください");
        if (!item.plannedTiming?.checkOut) add(item, `${item.title}：チェックアウト時刻を決める`, "前後の予定を踏まえて、この宿泊予定のチェックアウト時刻を決めたい");
        add(item, `${item.title}：宿泊先を選び直す`, "この宿泊予定の宿泊先を選び直したい。新しい宿を採用するまで元の宿を残してください", "review");
      }
    } else if (item.category === "free-time") add(item, `${item.title}：観光・過ごし方を決める`, "この自由時間の前後の予定を踏まえて、観光や過ごし方を相談したい");
    else if (!item.place) add(item, `${item.title}：場所・訪問時刻を確認する`, "この予定の名称を踏まえて、具体的な場所と訪問時刻を確認したい。名前が決まっていても、所在地・営業時間は未確認です");
    else if (item.schedule.type !== "fixed") add(item, `${item.title}：訪問時刻を決める`, "前後の予定を踏まえて、この予定の訪問時刻を決めたい");
  }
  for (const day of projection.days) {
    for (let index = 1; index < day.entries.length; index++) {
      const previous = day.entries[index - 1]!, next = day.entries[index]!;
      if (previous.sourceItemId === next.sourceItemId || previous.role === "continue" || next.role === "continue") continue;
      const before = trip.items.find(item => item.id === previous.sourceItemId)!, after = trip.items.find(item => item.id === next.sourceItemId)!;
      // Date-only entries can live in a separate zone bucket; do not mistake them
      // for an empty slot between the timed entries of the same calendar day.
      const sameDateIds = new Set(projection.days.filter(value => value.localDate === day.localDate).flatMap(value => value.entries.map(entry => entry.sourceItemId)));
      const beforeIndex = trip.items.indexOf(before), afterIndex = trip.items.indexOf(after);
      if (trip.items.some((item, itemIndex) => item.id !== before.id && item.id !== after.id && item.type !== "stay" &&
        (sameDateIds.has(item.id) || itemIndex > Math.min(beforeIndex, afterIndex) && itemIndex < Math.max(beforeIndex, afterIndex)) &&
        (item.schedule.type !== "fixed" || !item.schedule.endAt))) continue;
      const end = before.type === "stay" ? previous.role === "end" ? before.plannedTiming?.checkOut : undefined : before.schedule.type === "fixed" ? before.schedule.endAt : undefined;
      const start = after.type === "stay" ? next.role === "start" ? after.plannedTiming?.checkIn : undefined : after.schedule.type === "fixed" ? after.schedule.startAt : undefined;
      if (!end || !start || end.timeZone !== start.timeZone || !day.localDate || end.at.slice(0, 10) !== day.localDate || start.at.slice(0, 10) !== day.localDate || Date.parse(start.at) - Date.parse(end.at) < 60 * 60_000) continue;
      result.push({ section: "undecided", label: `${day.localDate} ${end.at.slice(11, 16)}–${start.at.slice(11, 16)}：観光を相談する`,
        prompt: `旅程「${trip.title}」の${day.localDate}、${trip.items.indexOf(before) + 1}番目の予定「${before.title}」の後から${trip.items.indexOf(after) + 1}番目の予定「${after.title}」の前（${end.at.slice(11, 16)}–${start.at.slice(11, 16)}）に入れられる観光を相談したい。移動時間も考慮し、前後の予定を保って提案してください。` });
    }
  }
  return result;
}
