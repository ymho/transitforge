import type { Train } from "@raiquora/train/train";
import { normalizeStationName } from "@raiquora/train/station-name";

/** Validate a model-proposed search starting point, not the user's home location. */
export function verifiedProvisionalOrigin(value: unknown, trains: readonly Train[]): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim() || value.length > 80) {
    throw new Error("仮の起点には収録されている駅名を指定してください。");
  }
  const normalized = normalizeStationName(value);
  const station = trains.flatMap((train) => [
    train.origin_station, train.destination_station, ...train.stops.flatMap((stop) => stop.station_name ? [stop.station_name] : []),
  ]).find((name) => normalizeStationName(name) === normalized);
  if (!station) throw new Error("仮の起点を時刻表内の駅として確認できません。地域のアクセス情報を調べ直すか、経路を除いた現地案を示してください。");
  return station;
}

export function provisionalOriginNotice(station: string): string {
  return `出発駅は未確定なので、いったん${station.replace(/駅$/u, "")}駅を起点にした仮案です。ご自宅からこの駅までの移動は含みません。\n\n`;
}
