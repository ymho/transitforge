import type { AdventureRisk } from "./travel-profile";

export type AdventureActivityKind = "public-transit" | "city-walk" | "night-activity" | "border-crossing" | "remote-area";
export interface AdventureProposal { kind: AdventureActivityKind; intensity: 0 | 1 | 2 | 3; risks: AdventureRisk[]; requiresCurrentEvidence: boolean; allowed: boolean; saferAlternative?: AdventureActivityKind }

export function assessAdventureActivity(kind: AdventureActivityKind, requestedIntensity: 0 | 1 | 2 | 3, avoided: readonly AdventureRisk[] = []): AdventureProposal {
  const risks: Record<AdventureActivityKind, AdventureRisk[]> = {
    "public-transit": [], "city-walk": [], "night-activity": ["night-isolation", "transport-stranding"],
    "border-crossing": ["unverified-border", "transport-stranding"], "remote-area": ["transport-stranding", "weather-exposure"],
  };
  const activityRisks = risks[kind];
  const blocked = activityRisks.some((risk) => avoided.includes(risk));
  return { kind, intensity: requestedIntensity, risks: activityRisks, requiresCurrentEvidence: kind === "border-crossing" || kind === "night-activity" || kind === "remote-area", allowed: !blocked,
    ...(blocked ? { saferAlternative: kind === "border-crossing" ? "city-walk" : "public-transit" } : {}) };
}

export function adventureIntensityFromRequest(request: string): 0 | 1 | 2 | 3 | undefined {
  const normalized = request.normalize("NFKC");
  if (/(危険|違法|命がけ)/u.test(normalized)) return 3;
  if (/(冒険|スリル|刺激|攻めた|危ない楽しみ)/u.test(normalized)) return 2;
  if (/(少し変わった|穴場|非日常)/u.test(normalized)) return 1;
  return undefined;
}
