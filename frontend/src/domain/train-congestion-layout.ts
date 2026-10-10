import type { TrainRenderLayout } from "./coupled-train-layout";

export interface TrainCongestionBar {
  congestion: number;
  centered: boolean;
}

/** The airport/Kishuji feed describes the whole coupled formation. */
export function congestionBarsForLayouts(
  layouts: TrainRenderLayout[],
  congestionByTrainNumber: ReadonlyMap<string, number>,
): ReadonlyMap<string, TrainCongestionBar> {
  const bars = new Map<string, TrainCongestionBar>();
  const layoutsByServiceUid = new Map(layouts.map((layout) => [layout.position.serviceUid, layout]));
  const processedPairs = new Set<string>();
  for (const layout of layouts) {
    const { position } = layout;
    const partner = layout.linkKind === "coupled-service"
      ? layoutsByServiceUid.get(layout.coupledServiceUid ?? "")
      : undefined;
    const shared = partner && isAirportKishuji(position.serviceType) &&
      isAirportKishuji(partner.position.serviceType);
    if (shared) {
      if (processedPairs.has(layout.bearingTrackingKey)) continue;
      processedPairs.add(layout.bearingTrackingKey);
      // Prefer the airport number, under which the full formation is published.
      const airport = isAirport(position.serviceType) ? layout : partner;
      const kishuji = airport === layout ? partner : layout;
      const congestion = congestionFor(airport, congestionByTrainNumber) ??
        congestionFor(kishuji, congestionByTrainNumber);
      if (congestion !== undefined) {
        bars.set(airport.position.serviceUid, { congestion, centered: true });
      }
    } else {
      const congestion = congestionFor(layout, congestionByTrainNumber);
      if (congestion !== undefined) bars.set(position.serviceUid, { congestion, centered: false });
    }
  }
  return bars;
}

function congestionFor(
  layout: TrainRenderLayout,
  values: ReadonlyMap<string, number>,
): number | undefined {
  const exact = values.get(layout.position.trainNo);
  if (exact !== undefined) return exact;
  if (!isAirport(layout.position.serviceType)) return undefined;
  const match = /^(\d+)M?$/u.exec(layout.position.trainNo);
  return match ? values.get(`${match[1]}M`) ?? values.get(match[1]) : undefined;
}

function isAirport(serviceType: string): boolean {
  return /関空(?:紀州路)?快速/u.test(serviceType);
}

function isAirportKishuji(serviceType: string): boolean {
  return isAirport(serviceType) || serviceType.includes("紀州路快速");
}
