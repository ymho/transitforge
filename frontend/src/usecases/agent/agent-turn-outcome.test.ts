import { createAgentTurnObservationStore } from "./agent-turn-observation-store";
import { describe, it, expect } from "vitest";
import { observeAgentTurn, acceptsAgentTurn } from "@raiquora/agent/agent-turn-outcome";
import { observeViewerTurn } from "./viewer-turn-progress";
import { AgentTraceRecorder } from "@raiquora/agent/agent-trace";
import { AgentToolRegistry } from "@raiquora/agent/tool-registry";
import { AgentToolExecutor } from "@raiquora/agent/agent-tool-executor";
import { ToolEvidenceRegistry } from "@raiquora/agent/tool-evidence-registry";
import { MultiStepAgentRuntime } from "@raiquora/agent/agent-runtime";

describe("ephemeral turn observation", () => {
  it("derives four outcomes from artifacts, never punctuation or status prose", () => {
    const progress = [{ kind: "candidates" as const, refs: ["a"] }];
    expect(observeAgentTurn(true, []).outcome).toBe("ask_only");
    expect(observeAgentTurn(true, progress).outcome).toBe("ask_and_progress");
    expect(observeAgentTurn(false, progress).outcome).toBe("progress");
    expect(observeViewerTurn("確認する地域を教えてください", [], undefined, true).outcome).toBe("ask_only");
    for (const text of ["条件を整理しました", "考えてみます", "?", "検索しました"]) expect(observeViewerTurn(text, []).outcome).toBe("answer");
    expect(observeAgentTurn(true, [{ kind: "itinerary", refs: [] }]).outcome).toBe("ask_only");
  });
  it("does not count state-only patches or internal tool results as progress", () => {
    expect(observeViewerTurn({ text: "整理しました", tripUpdateProposal: { tripId: "trip", baseRevision: 0, summary: "変更", patches: [{ type: "planning", state: "candidate_discovery" }] } }, []).progress).toEqual([]);
    expect(observeViewerTurn({ text: "検索しました", external: { webSearch: { status: "available", freshness: "fresh", evidence: [], data: { query: "x", results: [] } } } }, []).progress).toEqual([]);
    expect(observeViewerTurn({ text: "推薦", progressSources: [{ url: "https://example.com", evidenceId: "invented" }] }, []).progress).toEqual([]);
  });
  it("requires progress or an externalized exception after ask-only", () => {
    expect(acceptsAgentTurn("ask_only", observeAgentTurn(true, []))).toBe(false);
    expect(acceptsAgentTurn("ask_only", observeAgentTurn(true, [{ kind: "candidates", refs: ["a"] }]))).toBe(true);
    expect(acceptsAgentTurn("ask_only", observeAgentTurn(true, [], { reason: "safety", missingFact: "避難の必要性" }))).toBe(true);
  });
  it("scopes tab-lifetime metadata by session with bounded eviction and no persistence", () => {
    const store = createAgentTurnObservationStore(2);
    store.record("a", observeAgentTurn(true, [])); store.record("b", observeAgentTurn(false, []));
    expect(store.get("a")).toBe("ask_only"); expect(store.get("b")).toBe("answer");
    expect(createAgentTurnObservationStore().get("a")).toBeUndefined();
    store.record("c", observeAgentTurn(false, [])); expect(store.get("a")).toBeUndefined();
  });
  it("sanitizes observation traces rather than storing private reasoning/values", () => {
    const trace = new AgentTraceRecorder("turn");
    trace.turnObserved(observeAgentTurn(true, [], { reason: "safety", missingFact: "token=secret-value 現在地35.1234,135.4321" }), true);
    expect(JSON.stringify(trace.snapshot())).not.toMatch(/secret-value|35\.1234|135\.4321/);
  });
  it("bounded repair never returns rejected questions after exhausting runtime limits", async () => {
    const tools = new AgentToolRegistry(); let calls = 0;
    const runtime = new MultiStepAgentRuntime({ tools, toolExecutor: new AgentToolExecutor(tools, new ToolEvidenceRegistry()),
      limits: { maxIterations: 2, maxModelCalls: 2 },
      model: { generate: async () => { calls++; return { message: { role: "assistant", content: [{ type: "text", text: "条件を教えてください" }] }, stopReason: "completed", metadata: { provider: "fixture" } }; } },
      prepareResponse: (text) => ({ text, observation: observeAgentTurn(true, []) }),
    });
    const result = await runtime.run({ executionId: "bounded", feature: "travel_planning", userRequest: "前進して", context: { previousAssistantTurn: "ask_only" } });
    expect(calls).toBe(2); expect(result.status).toBe("limit_reached");
    expect(result.turnObservation).toBeUndefined(); expect(result.response).not.toContain("条件を教えてください");
  });
});
