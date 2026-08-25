import type { JourneySearchResponse } from "../../../domain/journey-search-service";

export const journeySearchContractVersion = "journey-search-v1" as const;

export interface JourneySearchWireResponse extends JourneySearchResponse {
  contractVersion: typeof journeySearchContractVersion;
}

export function toJourneySearchResponse(
  value: JourneySearchWireResponse,
): JourneySearchResponse {
  const { contractVersion: _, ...response } = value;
  return response;
}
