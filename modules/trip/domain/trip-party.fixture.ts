import type { TripRequest } from "./trip-request";
export function partyRequest(source: "profile" | "legacy" | "model" = "model"): TripRequest {
  return { constraints: [], party: { adults: 2, children: [{}], composition: ["family"], source: source === "model" ? "assumption" : source, assumptionId: "party" },
    assumptions: [{ id: "party", text: "大人2人と子ども1人で仮置き", source, status: "unconfirmed", affects: [{ type: "party" }] }] };
}
