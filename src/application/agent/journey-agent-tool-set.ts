import type { JourneySearchService } from "../../domain/journey-search-service";
import { createCompareJourneysTool } from "./compare-journeys-tool";
import { createSearchJourneysTool } from "./search-journeys-tool";
import { VerifiedJourneySearchResultStore } from "./verified-journey-results";

export function createJourneyAgentToolSet(service: JourneySearchService) {
  const verifiedResults = new VerifiedJourneySearchResultStore();
  return {
    verifiedResults,
    searchJourneys: createSearchJourneysTool(service, verifiedResults),
    compareJourneys: createCompareJourneysTool(verifiedResults),
  };
}
