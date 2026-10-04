import { bindRelativeSchedule, bindTimelineFromAnchor, type ItinerarySchedule } from "./itinerary-schedule";
import type { ItineraryItem, Trip } from "./trip";

/** Match verified calendar days, never names or model-authored destination labels.
 * An undated or multiply matching slot remains ambiguous. All alternatives must
 * identify the same slot before a common selection presentation can be retained.
 * For an unbound timeline, the exact user start date anchors its first logical
 * day locally. A missing request zone uses the verified alternatives' one zone;
 * this policy does not persist calendar bindings or change other Trip items. */
export function datedSearchSelectionTarget(items: readonly ItineraryItem[], slots: readonly ItineraryItem[], trip: Trip): ItineraryItem | undefined {
  let timeline = trip.timeline;
  const candidateZones = new Set(items.flatMap(item => item.schedule.type === "fixed" ? [item.schedule.startAt.timeZone] : item.schedule.type === "day" && item.schedule.timeZone ? [item.schedule.timeZone] : []));
  if (candidateZones.size !== 1) return undefined;
  const candidateZone = [...candidateZones][0]!;
  if (timeline && !timeline.calendarBindings.length) {
    const anchors = trip.request.constraints.filter(c => c.scope.type === "trip" && !c.scope.participantIds?.length && c.source === "user")
      .flatMap(c => c.requirement.type === "dates" && c.requirement.start.earliest === c.requirement.start.latest
        ? [{ date: c.requirement.start.earliest, timeZone: c.requirement.timeZone ?? candidateZone }] : []);
    if (anchors.length === 1) timeline = bindTimelineFromAnchor(timeline, timeline.logicalDays[0]!.id, anchors[0]!.date, anchors[0]!.timeZone);
  }
  const day = (schedule: ItinerarySchedule): { date: string; timeZone: string } | undefined => {
    if (schedule.type === "fixed") return { date: schedule.startAt.at.slice(0, 10), timeZone: schedule.startAt.timeZone };
    if (schedule.type === "day" && schedule.timeZone) return { date: schedule.date, timeZone: schedule.timeZone };
    if (schedule.type === "relative" && timeline) {
      const bound = bindRelativeSchedule(schedule, timeline);
      if (bound) return { date: bound.date, timeZone: bound.timeZone };
    }
    return undefined;
  };
  let target: ItineraryItem | undefined;
  for (const item of items) {
    const date = day(item.schedule);
    if (!date) return undefined;
    const matches = slots.filter(slot => {
      const bound = day(slot.schedule);
      return bound?.date === date.date && bound.timeZone === date.timeZone;
    });
    if (matches.length !== 1 || target && target.id !== matches[0]!.id) return undefined;
    target = matches[0];
  }
  return target;
}
