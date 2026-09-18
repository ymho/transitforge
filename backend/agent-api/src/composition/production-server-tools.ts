import { representativeTimetableEvidence } from "@raiquora/agent/representative-timetable-evidence";
import { representativeTimetableToolDescriptor } from "@raiquora/agent/representative-timetable-tool-descriptor";
import { externalTravelToolDescription, externalTravelToolInputSchema, executeExternalTravelTool, type ExternalTravelToolDependencies, type ExternalTravelToolState } from "@raiquora/agent/external-travel-tools";
import { externalTravelEvidence } from "@raiquora/agent/external-travel-evidence";
import { accommodationToolDescriptor } from "@raiquora/agent/accommodation-tool-descriptor";
import { createSearchJourneysTool } from "@raiquora/agent/search-journeys-tool";
import { evidenceFromJourneySearch } from "@raiquora/agent/journey-search-evidence";
import type { JourneySearchResponse } from "@raiquora/journey/journey-search-service";
import type { AgentOperation } from "../ports/agent-operation.js";
import type { ServerAgentToolBinding } from "../usecases/agent/server-tools.js";

/** Per-turn provider state; no Browser storage or public HTTP round trip. */
export function productionServerTools(options: {
  external: ExternalTravelToolDependencies;
  accommodation: AgentOperation;
  journey: AgentOperation;
  representativeTimetable?: AgentOperation;
}): ServerAgentToolBinding[] {
  const state: ExternalTravelToolState = {};
  const names = ["search_place_media", "search_travel_alerts", "search_ground_access", "search_restaurants", "search_web", "read_web_pages", "resolve_place_candidates"] as const;
  const journeyDescriptor = createSearchJourneysTool({ search: async () => { throw new Error("descriptor only"); } });
  return [
    ...(options.representativeTimetable ? [{ descriptor: representativeTimetableToolDescriptor, operation: options.representativeTimetable, evidence: representativeTimetableEvidence }] : []),
    ...names.map(name => ({
      descriptor: { name, description: externalTravelToolDescription(name), inputSchema: externalTravelToolInputSchema(name) },
      operation: (async input => ({ body: await executeExternalTravelTool(name, input, options.external, state) as Record<string, unknown> })) as AgentOperation,
      evidence: externalTravelEvidence,
    })),
    { descriptor: accommodationToolDescriptor, operation: options.accommodation, evidence: externalTravelEvidence },
    { descriptor: journeyDescriptor, operation: (input, context) => options.journey({ ...input, contractVersion: "journey-search-v1" }, context), evidence: (output, context) => evidenceFromJourneySearch(output as JourneySearchResponse, context) },
  ];
}
