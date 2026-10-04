import { validateZonedInstant, validateTimeZone, type ZonedInstant } from "@raiquora/trip/itinerary-schedule";
import { validDate } from "@raiquora/trip/selected-rail-journey";
import { instantInZone } from "@raiquora/trip/weather-event-fact";

/** A visible, user-authored zone. Never interpret local input in the device's timezone. */
export function plannedTimeInput(date: string, time: string, timeZone: string, explicitOffset?: string): ZonedInstant {
  if (!validDate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("日付と時刻を入力してください。");
  validateTimeZone(timeZone);
  const wall = `${date}T${time}:00`;
  if (explicitOffset) {
    if (!/^[+-]\d{2}:\d{2}$/.test(explicitOffset)) throw new Error("UTC差は+09:00の形式で入力してください。");
    const value = { at: `${wall}${explicitOffset}`, timeZone }; validateZonedInstant(value); return value;
  }
  const base = Date.parse(`${wall}Z`), matches = new Map<number, ZonedInstant>();
  for (let hours = -36; hours <= 36; hours += 6) {
    const probe = base + hours * 3600000, local = instantInZone(probe, timeZone);
    const epoch = base - (Date.parse(`${local.at.slice(0, 19)}Z`) - probe);
    const candidate = instantInZone(epoch, timeZone);
    if (candidate.at.slice(0, 19) === wall) matches.set(epoch, candidate);
  }
  if (matches.size !== 1) throw new Error("この時刻は夏時間の切替で存在しないか重複します。時刻を変更するかUTC差を指定してください。");
  return [...matches.values()][0]!;
}
