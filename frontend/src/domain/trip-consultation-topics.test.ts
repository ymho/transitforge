import { describe, expect, it } from "vitest";
import { createTrip, type ActivityItineraryItem } from "@raiquora/trip/trip";
import { multiCityTrip, placesAt, placesTripId, placeStay } from "../../../modules/trip/domain/trip-places.fixture";
import { tripConsultationTopics, tripConsultationExamples } from "./trip-consultation-topics";

const instant = (time: string) => ({ at: `2026-09-22T${time}:00+09:00`, timeZone: "Asia/Tokyo" });
const visit = (id: string, start: string, end?: string): ActivityItineraryItem => ({ id, title: "観光", type: "activity", category: "sightseeing", place: { name: id, sources: [] }, schedule: { type: "fixed", startAt: instant(start), ...(end ? { endAt: instant(end) } : {}) } });
const tripWith = (items: Parameters<typeof createTrip>[3]) => createTrip(placesTripId, "旅", placesAt, items);

describe("saved Trip consultation topics", () => {
  it("shows at most three varied examples and fills from real saved decisions only", () => {
    const base = multiCityTrip();
    const trip = { ...base, items: [...base.items,
      { id: "outbound", title: "行き", type: "transport" as const, schedule: { type: "unscheduled" as const }, detail: { status: "unresolved" as const, mode: "rail" as const } }] };
    const before = structuredClone(trip), examples = tripConsultationExamples(trip);
    expect(examples).toHaveLength(3);
    expect(new Set(examples.map(topic => topic.itemId)).size).toBe(3);
    expect(examples.every(topic => topic.section === "undecided")).toBe(true);
    expect(tripConsultationExamples(tripWith([placeStay("hotel", "宿")]))).toHaveLength(3);
    expect(tripConsultationExamples(tripWith([]))).toEqual([]);
    expect(trip).toEqual(before);
  });
  it("distinguishes unresolved choices from selected content without mutating saved facts", () => {
    const base = multiCityTrip();
    const trip = { ...base, items: [...base.items,
      { id: "outbound", title: "行き", type: "transport" as const, schedule: { type: "unscheduled" as const }, detail: { status: "unresolved" as const, mode: "rail" as const } },
      { id: "stay", title: "宿泊", type: "stay" as const, schedule: { type: "unscheduled" as const }, selection: { status: "unselected" as const } }] };
    const before = structuredClone(trip), topics = tripConsultationTopics(trip);
    expect(topics.find(topic => topic.itemId === "outbound")?.label).toBe("行き：列車を決める");
    expect(topics.find(topic => topic.itemId === "stay")?.label).toBe("宿泊：宿泊先を決める");
    expect(topics.filter(topic => topic.itemId === "hotel" && topic.section === "undecided").map(topic => topic.label)).toEqual(["宿泊：チェックイン時刻を決める", "宿泊：チェックアウト時刻を決める"]);
    expect(topics.find(topic => topic.itemId === "hotel" && topic.section === "review")?.label).toContain("選び直す");
    expect(topics.find(topic => topic.itemId === "stay")?.context).toBe("日付未定・5番目");
    expect(topics.find(topic => topic.itemId === "hotel")?.context).toBe("2026-09-22・2番目");
    expect(trip).toEqual(before);
  });
  it("does not ask for already registered hotel times or infer choices from booking marks", () => {
    const stay = placeStay("hotel", "宿");
    const trip = tripWith([{ ...stay, bookingStatus: "booked", plannedTiming: { checkIn: instant("15:00"), checkOut: { at: "2026-09-23T10:00:00+09:00", timeZone: "Asia/Tokyo" } } }]);
    expect(tripConsultationTopics(trip).filter(topic => topic.section === "undecided")).toEqual([]);
  });
  it("offers sightseeing only between adjacent known times at least an hour apart", () => {
    const topics = tripConsultationTopics(tripWith([visit("a", "09:00", "10:00"), visit("b", "12:00", "13:00")]));
    expect(topics).toHaveLength(1);
    expect(topics[0]?.label).toContain("10:00–12:00");
    expect(topics[0]?.itemId).toBeUndefined();
    expect(topics[0]?.prompt).toContain('1番目の予定「観光」の後から2番目の予定「観光」の前');
    expect(tripConsultationTopics(tripWith([visit("a", "09:00", "10:00"), visit("b", "10:59", "12:00")]))).toEqual([]);
    expect(tripConsultationTopics(tripWith([visit("a", "09:00"), visit("b", "12:00")]))).toEqual([]);
    expect(tripConsultationTopics(tripWith([visit("a", "09:00", "13:00"), visit("b", "12:00")]))).toEqual([]);
  });
  it("does not skip unknown intervening plans to invent an empty gap", () => {
    const uncertain: ActivityItineraryItem = { id: "middle", title: "昼食", type: "activity", category: "food", place: { name: "食堂", sources: [] }, schedule: { type: "day", date: "2026-09-22" } };
    const topics = tripConsultationTopics(tripWith([visit("a", "09:00", "10:00"), uncertain, visit("b", "12:00")]));
    expect(topics.every(topic => topic.itemId === "middle")).toBe(true);
  });
  it("returns no fabricated decisions for an empty Trip", () => {
    expect(tripConsultationTopics(tripWith([]))).toEqual([]);
  });
});
