import { representativeTimetableEvidence } from "@raiquora/agent/representative-timetable-evidence";
import { representativeTimetableToolDescriptor } from "@raiquora/agent/representative-timetable-tool-descriptor";
import { externalTravelToolDescription, externalTravelToolInputSchema, executeExternalTravelTool, isSpecificPlaceCandidateName, type ExternalTravelToolDependencies, type ExternalTravelToolState } from "@raiquora/agent/external-travel-tools";
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
  const enrichPagesWithMedia = async (output: Record<string, unknown>): Promise<Record<string, unknown>> => {
    if (!options.external.searchPlaceMedia || !state.webPages?.data?.pages?.length) return output;
    const page = state.webPages.data.pages[0];
    const title = page?.title?.split(/[|｜]/u, 1)[0]?.trim();
    if (!page || !title || !isSpecificPlaceCandidateName(title)) return output;
    try {
      const media = await executeExternalTravelTool("search_place_media", { query: title, mode: "target", sourceUrl: page.url, limit: 3 }, options.external, state);
      return media && typeof media === "object" && "result" in media ? { ...output, ...media } : output;
    } catch {
      return output;
    }
  };
  return [
    ...(options.discovery ? [{ descriptor: travelDiscoveryToolDescriptor, operation: (async (input, context) => {
      const response = await options.discovery!(input, context);
      if ((response.statusCode ?? 200) >= 400 || !options.external.readWebPages) return response;
      const body = response.body as Record<string, unknown>;
      const discovery = body.discovery as { batch?: { hits?: Array<{ sourceRef?: string; retrievalChannel?: string }> } } | undefined;
      // Discovery hits are leads, never verified facts. Materialize a small, bounded
      // number of web pages in this same Tool round so vague requests can acquire
      // source-bound evidence before the model enters the strict presentation phase.
      const urls = [...new Set((discovery?.batch?.hits ?? []).filter((hit) => hit.retrievalChannel === "web")
        .map((hit) => hit.sourceRef).filter((url): url is string => typeof url === "string" && /^https:\/\//u.test(url)))].slice(0, 3);
      if (!urls.length) return response;
      try {
        const pages = await options.external.readWebPages({ urls });
        if (pages && typeof pages === "object" && "webPages" in pages) {
          state.webPages = (pages as { webPages: ExternalTravelToolState["webPages"] }).webPages;
          return { ...response, body: await enrichPagesWithMedia({ ...body, ...pages }) };
        }
      } catch {
        // Keep the discovery result available for a subsequent explicit read.
      }
      return response;
    }) as AgentOperation, evidence: (output: unknown, context: Parameters<typeof discoveryEvidence>[1]) =>
      [...discoveryEvidence(output, context), ...materializedEvidence(output, context)] }] : []),
    ...(options.representativeTimetable ? [{ descriptor: representativeTimetableToolDescriptor, operation: options.representativeTimetable, evidence: representativeTimetableEvidence }] : []),
    ...names.map(name => ({
      descriptor: { name, description: externalTravelToolDescription(name), inputSchema: externalTravelToolInputSchema(name) },
      operation: (async input => {
        const output = await executeExternalTravelTool(name, input, options.external, state) as Record<string, unknown>;
        if (name === "search_web" && options.external.readWebPages) {
          const search = output.webSearch as { data?: { results?: Array<{ url?: string }> } } | undefined;
          const urls = [...new Set((search?.data?.results ?? []).map((hit) => hit.url)
            .filter((url): url is string => typeof url === "string" && /^https:\/\//u.test(url)))].slice(0, 3);
          if (urls.length) {
            try {
              const pages = await options.external.readWebPages({ urls });
              if (pages && typeof pages === "object" && "webPages" in pages) {
                state.webPages = (pages as { webPages: ExternalTravelToolState["webPages"] }).webPages;
                return { body: await enrichPagesWithMedia({ ...output, ...pages }) };
              }
            } catch {
              // Search results remain unverified leads when page reading fails.
            }
          }
        }
        return { body: output };
      }) as AgentOperation,
      evidence: (output: unknown, context: Parameters<typeof externalTravelEvidence>[1]) => {
        return name === "search_web" && output && typeof output === "object" && "webPages" in output
          ? [...externalTravelEvidence({ webSearch: (output as Record<string, unknown>).webSearch }, context), ...materializedEvidence(output, context)]
          : externalTravelEvidence(output, context);
      },
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

function materializedEvidence(output: unknown, context: Parameters<typeof externalTravelEvidence>[1]) {
  if (!output || typeof output !== "object") return [];
  const values = output as Record<string, unknown>;
  return [...(values.webPages ? externalTravelEvidence({ webPages: values.webPages }, context) : []),
    ...(values.result ? externalTravelEvidence({ result: values.result }, context) : [])];
}
