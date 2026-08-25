import type { JourneySearchService } from "../journey-search-service";
import type { NetworkInspectionService } from "../network-inspection-service";
import {
  createInspectStationTool,
  createInspectTrainTool,
} from "./network-inspection-tools";
import {
  createAnalyzeCongestionTool,
  createAnalyzeDelayTool,
  type OperationalAnalysisDependencies,
} from "./operational-analysis-tools";
import { createSearchJourneysTool } from "./search-journeys-tool";
import { AgentToolRegistry } from "./tool-registry";

export const readonlyTransitToolNames = [
  "search_journeys",
  "inspect_train",
  "inspect_station",
  "analyze_delay",
  "analyze_congestion",
] as const;

export type ReadonlyTransitToolName = typeof readonlyTransitToolNames[number];

export interface ReadonlyTransitToolDependencies {
  journeySearch: JourneySearchService;
  networkInspection: NetworkInspectionService;
  operationalAnalysis: OperationalAnalysisDependencies;
}

/**
 * 内部Agentと外部Adapterが共有する読み取り専用の交通Tool集合を組み立てる。
 * Viewer Actionや書き込み能力はこの境界へ登録しない。
 */
export function createReadonlyTransitToolRegistry(
  dependencies: ReadonlyTransitToolDependencies,
): AgentToolRegistry {
  const registry = new AgentToolRegistry();
  registry.register(createSearchJourneysTool(dependencies.journeySearch));
  registry.register(createInspectTrainTool(dependencies.networkInspection));
  registry.register(createInspectStationTool(dependencies.networkInspection));
  registry.register(createAnalyzeDelayTool(dependencies.operationalAnalysis));
  registry.register(createAnalyzeCongestionTool(dependencies.operationalAnalysis));
  return registry;
}
