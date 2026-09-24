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
import { discoveryEvidence } from "@raiquora/agent/discovery-evidence";
import { travelDiscoveryToolDescriptor } from "../usecases/discover-travel-candidates.js";
import { compareJourneySearchResult } from "@raiquora/journey/journey-comparison-service";

/** Per-turn provider state; no Browser storage or public HTTP round trip. */
export function productionServerTools(options: {
  external: ExternalTravelToolDependencies;
  accommodation: AgentOperation;
  journey: AgentOperation;
  representativeTimetable?: AgentOperation;
  discovery?: AgentOperation;
  onJourneyResult?: (result: JourneySearchResponse) => void;
}): ServerAgentToolBinding[] {
  const state: ExternalTravelToolState = {};
  const journeyResults = new Map<string, JourneySearchResponse>();
  const names = ["search_place_media", "search_travel_alerts", "search_ground_access", "search_restaurants", "search_web", "read_web_pages", "resolve_place_candidates"] as const;
  const journeyDescriptor = createSearchJourneysTool({ search: async () => { throw new Error("descriptor only"); } });
  return [
    ...(options.discovery ? [{ descriptor: travelDiscoveryToolDescriptor, operation: options.discovery, evidence: discoveryEvidence }] : []),
    ...(options.representativeTimetable ? [{ descriptor: representativeTimetableToolDescriptor, operation: options.representativeTimetable, evidence: representativeTimetableEvidence }] : []),
    ...names.map(name => ({
      descriptor: { name, description: externalTravelToolDescription(name), inputSchema: externalTravelToolInputSchema(name) },
      operation: (async input => ({ body: await executeExternalTravelTool(name, input, options.external, state) as Record<string, unknown> })) as AgentOperation,
      evidence: externalTravelEvidence,
    })),
    { descriptor: accommodationToolDescriptor, operation: options.accommodation, evidence: externalTravelEvidence },
    { descriptor: journeyDescriptor, operation: async (input, context) => {
      const response = await options.journey({ ...input, contractVersion: "journey-search-v1" }, context);
      if ((response.statusCode ?? 200) >= 400) return response;
      const result = structuredClone(response.body) as unknown as JourneySearchResponse;
      if (journeyResults.size >= 4) return { statusCode: 429, body: { code: "rate_limited", message: "経路検索結果の保持上限を超えました" } };
      const searchResultId = `journey-search-${journeyResults.size + 1}`;
      journeyResults.set(searchResultId, result); options.onJourneyResult?.(result);
      return { ...response, body: { ...response.body, searchResultId } };
    }, evidence: (output, context) => evidenceFromJourneySearch(output as JourneySearchResponse, context) },
    { descriptor: {
      name: "compare_journeys", description: "同じ実行内で検索済みの検証済み鉄道経路を時刻、乗換、遅延、制約で比較します",
      inputSchema: { type: "object", properties: { searchResultId: { type: "string", maxLength: 160 }, journeyIndexes: { type: "array", maxItems: 3, items: { type: "integer", minimum: 0 } } }, required: ["searchResultId"], additionalProperties: false },
    }, operation: async input => {
      const result = journeyResults.get(String(input.searchResultId));
      if (!result) return { statusCode: 404, body: { code: "not_found", message: "同じ実行内に検証済みの経路検索結果がありません" } };
      try { return { body: compareJourneySearchResult(result, { ...(Array.isArray(input.journeyIndexes) ? { journeyIndexes: input.journeyIndexes as number[] } : {}) }) as unknown as Record<string, unknown> }; }
      catch { return { statusCode: 400, body: { code: "invalid_input", message: "経路候補を比較できません" } }; }
    }, evidence: () => [] },
  ];
}
