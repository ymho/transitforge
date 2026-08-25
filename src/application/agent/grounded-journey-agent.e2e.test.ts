import { describe, expect, it, vi } from "vitest";

import type {
  JourneySearchResponse,
  JourneySearchService,
} from "../../domain/journey-search-service";
import { ViewerActionExecutor } from "../viewer/viewer-action-executor";
import { MultiStepAgentRuntime } from "./agent-runtime";
import { AgentToolExecutor } from "./agent-tool-executor";
import { createJourneyAgentToolSet } from "./journey-agent-tool-set";
import type {
  AgentModelProvider,
  AgentModelRequest,
  AgentModelResponse,
} from "./model-provider";
import { AgentToolRegistry } from "./tool-registry";
import { ToolEvidenceRegistry } from "./tool-evidence-registry";
import {
  evidenceFromJourneyComparison,
  evidenceFromJourneySearch,
} from "./tool-result-evidence";
import { StructuredAgentResponseGenerator } from "./structured-response-generator";
import { EvidenceScopedViewerActionHandler } from "./viewer-action-handler";
import type { JourneyComparison } from "../../domain/journey-comparison-service";

const executionId = "grounded-e2e-1";
const selectedJourneyEvidenceId = "journey:2026-08-25:1";
const comparisonEvidenceId = "journey-comparison:2026-08-25:journey-2";

describe("Grounded journey Agent E2E", () => {
  it("searches compares grounds and applies safe Viewer actions using one task", async () => {
    const search = vi.fn(async () => journeyFixture());
    const highlightRoute = vi.fn(() => true);
    const showEvidence = vi.fn(() => true);
    const model = new JourneyScenarioModel(false);
    const runtime = runtimeFor(
      { search },
      model,
      highlightRoute,
      showEvidence,
    );

    const output = await runtime.run({
      executionId,
      feature: "journey_planning",
      userRequest: "今日8時以降に京都から岡山へ 遅延も考慮して比較して",
    });

    expect(output.status).toBe("completed");
    expect(output.response).toContain("候補2");
    expect(output.response).toContain("遅延を考慮");
    expect(search).toHaveBeenCalledTimes(1);
    expect(model.toolOrder).toEqual(["search_journeys", "compare_journeys"]);
    expect(output.claims).toEqual([
      expect.objectContaining({
        id: "claim-recommendation",
        groundingStatus: "supported",
        evidenceIds: [comparisonEvidenceId],
      }),
    ]);
    expect(output.evidence.map(({ id }) => id)).toEqual(expect.arrayContaining([
      selectedJourneyEvidenceId,
      comparisonEvidenceId,
    ]));
    expect(highlightRoute).toHaveBeenCalledWith(selectedJourneyEvidenceId);
    expect(showEvidence).toHaveBeenCalledWith([comparisonEvidenceId]);
    expect(output.viewerActions).toEqual([
      { actionType: "highlight_route", status: "applied" },
      { actionType: "show_evidence", status: "applied" },
    ]);
    const trace = output.trace.events;
    expect(trace.filter((event) => event.type === "tool_called")
      .map((event) => event.type === "tool_called" ? event.toolName : ""))
      .toEqual(["search_journeys", "compare_journeys"]);
    expect(trace.filter((event) => event.type === "viewer_action")
      .map((event) => event.type === "viewer_action" ? event.status : ""))
      .toEqual(["proposed", "applied", "proposed", "applied"]);
  });

  it("does not answer or operate the Viewer when a railway fact has no Evidence", async () => {
    const highlightRoute = vi.fn(() => true);
    const showEvidence = vi.fn(() => true);
    const runtime = runtimeFor(
      { search: async () => journeyFixture() },
      new JourneyScenarioModel(true),
      highlightRoute,
      showEvidence,
    );

    const output = await runtime.run({
      executionId,
      feature: "journey_planning",
      userRequest: "京都から岡山へ行きたい",
    });

    expect(output.status).toBe("failed");
    expect(output.response).toBe("確認できた根拠だけでは回答できません");
    expect(output.claims).toEqual([
      expect.objectContaining({
        groundingStatus: "unsupported",
        missingEvidenceIds: ["invented-evidence"],
      }),
    ]);
    expect(highlightRoute).not.toHaveBeenCalled();
    expect(showEvidence).not.toHaveBeenCalled();
    expect(output.viewerActions).toEqual([]);
    expect(output.trace.events.at(-1)).toMatchObject({
      type: "task_completed",
      reason: "unsupported_claim",
    });
  });
});

function runtimeFor(
  service: JourneySearchService,
  model: AgentModelProvider,
  highlightRoute: (journeyId: string) => boolean,
  showEvidence: (evidenceIds: string[]) => boolean,
) {
  const toolSet = createJourneyAgentToolSet(service);
  const tools = new AgentToolRegistry();
  tools.register(toolSet.searchJourneys);
  tools.register(toolSet.compareJourneys);
  const evidenceMappers = new ToolEvidenceRegistry();
  evidenceMappers.register("search_journeys", (output, context) =>
    evidenceFromJourneySearch(output as JourneySearchResponse, context));
  evidenceMappers.register("compare_journeys", (output, context) =>
    evidenceFromJourneyComparison(output as JourneyComparison, context));
  const viewerExecutor = new ViewerActionExecutor({
    setDisplayTime: vi.fn(),
    focusTrain: vi.fn(() => true),
    highlightRoute,
    compareJourneys: vi.fn(() => true),
    showEvidence,
  }, 2_880);
  return new MultiStepAgentRuntime({
    model,
    tools,
    toolExecutor: new AgentToolExecutor(tools, evidenceMappers),
    responseGenerator: new StructuredAgentResponseGenerator(),
    viewerActionHandler: new EvidenceScopedViewerActionHandler(viewerExecutor),
  });
}

class JourneyScenarioModel implements AgentModelProvider {
  readonly toolOrder: string[] = [];
  private callCount = 0;

  constructor(private readonly unsupportedFinalClaim: boolean) {}

  async generate(request: AgentModelRequest): Promise<AgentModelResponse> {
    this.callCount += 1;
    if (this.callCount === 1) {
      this.toolOrder.push("search_journeys");
      return toolCall("search-1", "search_journeys", {
        serviceDate: "2026-08-25",
        originStation: "京都",
        destinationStation: "岡山",
        departureTimeMinutes: 480,
        limit: 2,
        maxTransfers: 1,
        rankingPreference: "earliest-arrival",
      });
    }
    const lastResult = toolResultFrom(request);
    if (this.callCount === 2 && !this.unsupportedFinalClaim) {
      const searchResultId = (lastResult.output as { searchResultId?: string })
        .searchResultId;
      if (!searchResultId) throw new Error("searchResultId was not returned");
      this.toolOrder.push("compare_journeys");
      return toolCall("compare-1", "compare_journeys", { searchResultId });
    }
    if (this.callCount === 3 && !this.unsupportedFinalClaim) {
      const comparison = lastResult.output as JourneyComparison;
      if (comparison.recommendedCandidateId !== "journey-2") {
        throw new Error("unexpected recommendation");
      }
      return structuredResponse({
        text: "遅延を考慮すると候補2が早く到着します",
        claims: [{
          id: "claim-recommendation",
          statement: "候補2が比較条件内で推奨される",
          kind: "fact",
          evidenceIds: [comparisonEvidenceId],
        }],
        viewerActions: [
          { type: "highlight_route", journeyId: selectedJourneyEvidenceId },
          { type: "show_evidence", evidenceIds: [comparisonEvidenceId] },
        ],
      });
    }
    return structuredResponse({
      text: "根拠のない列車が最速です",
      claims: [{
        id: "unsupported-claim",
        statement: "根拠のない列車が最速である",
        kind: "fact",
        evidenceIds: ["invented-evidence"],
      }],
      viewerActions: [{
        type: "highlight_route",
        journeyId: selectedJourneyEvidenceId,
      }],
    });
  }
}

function toolCall(
  toolCallId: string,
  name: string,
  input: Record<string, unknown>,
): AgentModelResponse {
  return {
    message: {
      role: "assistant",
      content: [{ type: "tool_call", toolCallId, name, input }],
    },
    stopReason: "tool_calls",
    metadata: { provider: "fixed-e2e", model: "fixture" },
  };
}

function structuredResponse(value: unknown): AgentModelResponse {
  return {
    message: {
      role: "assistant",
      content: [{ type: "text", text: JSON.stringify(value) }],
    },
    stopReason: "completed",
    metadata: {
      provider: "fixed-e2e",
      model: "fixture",
      latencyMs: 1,
      usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
    },
  };
}

function toolResultFrom(request: AgentModelRequest) {
  const content = request.messages.at(-1)?.content[0];
  if (!content || content.type !== "tool_result" || content.status !== "success") {
    throw new Error("expected successful tool result");
  }
  return content;
}

function journeyFixture(): JourneySearchResponse {
  return {
    serviceDate: "2026-08-25",
    originStation: "京都",
    destinationStation: "岡山",
    searchTimeMinutes: 480,
    totalMatchCount: 2,
    rankingPreference: "earliest-arrival",
    maxTransfers: 1,
    matches: [
      match("delayed-direct", "1001M", "新快速", 495, 615, 15, "observed"),
      match("rapid", "2001M", "新快速", 490, 540, 0),
      match("local", "2003M", "普通", 550, 600, 0),
    ],
    journeys: [
      {
        departureTimeMinutes: 495,
        arrivalTimeMinutes: 615,
        transferCount: 0,
        legs: [leg("delayed-direct", "1001M", "新快速", "京都", "岡山", 495, 615, 15, "observed")],
      },
      {
        departureTimeMinutes: 490,
        arrivalTimeMinutes: 600,
        transferCount: 1,
        legs: [
          leg("rapid", "2001M", "新快速", "京都", "姫路", 490, 540, 0),
          leg("local", "2003M", "普通", "姫路", "岡山", 550, 600, 0),
        ],
      },
    ],
  };
}

function match(
  serviceUid: string,
  trainNumber: string,
  serviceType: string,
  departureTimeMinutes: number,
  arrivalTimeMinutes: number,
  delayMinutes: number,
  delayStatus?: "observed" | "estimated",
): JourneySearchResponse["matches"][number] {
  return {
    serviceUid,
    trainNumber,
    serviceType,
    trainName: "",
    originStation: "京都",
    destinationStation: "岡山",
    departureTimeMinutes,
    arrivalTimeMinutes,
    scheduledDepartureTimeMinutes: departureTimeMinutes - delayMinutes,
    scheduledArrivalTimeMinutes: arrivalTimeMinutes - delayMinutes,
    delayMinutes,
    ...(delayStatus ? { delayStatus } : {}),
    source: "transitforge",
    discoverySource: "timetable-graph",
    sourceReference: "fixture/2026-08-25/connection-index.json.gz",
  };
}

function leg(
  serviceUid: string,
  trainNumber: string,
  serviceType: string,
  originStation: string,
  destinationStation: string,
  departureTimeMinutes: number,
  arrivalTimeMinutes: number,
  delayMinutes: number,
  delayStatus?: "observed" | "estimated",
): JourneySearchResponse["journeys"][number]["legs"][number] {
  return {
    serviceUid,
    trainNumber,
    serviceType,
    trainName: "",
    originStation,
    destinationStation,
    departureTimeMinutes,
    arrivalTimeMinutes,
    scheduledDepartureTimeMinutes: departureTimeMinutes - delayMinutes,
    scheduledArrivalTimeMinutes: arrivalTimeMinutes - delayMinutes,
    delayMinutes,
    ...(delayStatus ? { delayStatus } : {}),
  };
}
