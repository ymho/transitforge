import type { TrustedPrincipal } from "../../contracts/trusted-principal.js";
import { authenticatedApplication } from "../authenticated-application.js";
import { describe, expect, it, vi } from "vitest";
import type { AgentModelRequest, AgentModelResponse } from "@raiquora/agent/model-provider";
import { successfulAgentToolResult, validAgentToolInput } from "@raiquora/agent/tool-contract";
import { createServerAgentApplication } from "./server-agent.js";
import type { Evidence } from "@raiquora/agent/evidence-model";

const final: AgentModelResponse = { message: { role: "assistant", content: [{ type: "text", text: "こんにちは" }] }, stopReason: "completed", metadata: { provider: "fake" } };
const call: AgentModelResponse = { ...final, stopReason: "tool_calls", message: { role: "assistant", content: [{ type: "tool_call", name: "fake_tool", toolCallId: "call-1", input: {} }] } };
function setup(responses: AgentModelResponse[] = [call, final], maxExecutionMs = 1_000) {
  const requests: AgentModelRequest[] = [];
  const execute = vi.fn(async () => successfulAgentToolResult({ checked: true }));
  const app = createServerAgentApplication({ newExecutionId: () => "execution-1", limits: { maxExecutionMs },
    createModel: () => ({ generate: async request => { requests.push(structuredClone(request)); return responses.shift() ?? final; } }),
    registerTools: tools => tools.register({ name: "fake_tool", description: "fake", inputSchema: { type: "object", properties: {} },
      parseInput: value => validAgentToolInput(value), execute }),
  });
  return { app, requests, execute };
}
const fakePrincipal = (subject: string): TrustedPrincipal => ({ subject, identity: { issuer: "https://issuer.example.test", subject }, scopes: ["raiquora/user"] });
const input = { principal: fakePrincipal("fake-principal"), userRequest: "確認して" };
const retainedSource: Evidence = { id: "evidence:izumo", category: "external", knowledgeKind: "deterministic_fact", subject: "出雲大社",
  facts: { status: "available", freshness: "fresh", sourceTitle: "出雲大社", sourceExcerpt: "出雲市にある神社です。", sourceUrl: "https://example.test/izumo" },
  references: [{ sourceType: "external-source", sourceRef: "https://example.test/izumo", retrievedAt: "2026-09-24T00:00:00Z", freshness: "current", summary: "公式情報" }],
  observation: { observationId: "evidence:izumo", subjectKey: "place:izumo", scopeKey: "izumo", predicate: "place_description", retrievedAt: "2026-09-24T00:00:00Z",
    applicability: "applicable", retention: "bounded_excerpt" } };

describe("Server Agent Application without Browser APIs", () => {
  it("completes model -> tool -> result -> model -> final with an ordered trace", async () => {
    const { app, requests, execute } = setup();
    const result = await app.runAgentTurn(input);
    expect(result.status).toBe("completed");
    expect(requests).toHaveLength(2);
    expect(execute).toHaveBeenCalledOnce();
    expect(requests[1].messages.at(-1)).toMatchObject({ role: "user", content: [{ type: "tool_result", toolCallId: "call-1", status: "success", output: { checked: true } }] });
    const types = result.trace.events.map(event => event.type);
    expect(types.filter(type => ["model_completed", "tool_called", "tool_completed", "response_generated"].includes(type)))
      .toEqual(["model_completed", "tool_called", "tool_completed", "model_completed", "response_generated"]);
    expect(JSON.stringify(result.trace)).not.toContain("fake-principal");
  });
  it("delegates the model/tool loop to an injected runtime without constructing the V1 model", async () => {
    const createModel = vi.fn(() => { throw new Error("V1 model must not be created"); });
    const runRuntime = vi.fn(async ({ executionId, tools }: Parameters<NonNullable<Parameters<typeof createServerAgentApplication>[0]["runRuntime"]>>[0]) => ({
      status: "completed" as const,
      response: "Strands runtime response",
      evidence: [],
      claims: [],
      trace: { executionId, events: [], droppedEventCount: 0 },
    }));
    const app = createServerAgentApplication({
      newExecutionId: () => "strands-execution",
      createModel,
      registerTools: tools => tools.register({ name: "read_only", description: "read", effect: "read",
        inputSchema: { type: "object", properties: {} }, parseInput: validAgentToolInput,
        execute: async () => successfulAgentToolResult({ ok: true }) }),
      runRuntime,
    });

    const result = await app.runAgentTurn(input);

    expect(result.status).toBe("completed");
    expect(result.response).toBe("Strands runtime response");
    expect(createModel).not.toHaveBeenCalled();
    expect(runRuntime).toHaveBeenCalledOnce();
    expect(runRuntime.mock.calls[0]?.[0].tools.descriptors().map(({ name }) => name)).toEqual(["read_only"]);
  });

  it("does not execute duplicate calls", async () => {
    const { app, execute } = setup([call, { ...call, message: { ...call.message, content: [{ type: "tool_call", name: "fake_tool", toolCallId: "call-2", input: {} }] } }, final]);
    await app.runAgentTurn(input);
    expect(execute).toHaveBeenCalledOnce();
  });
  it("bounds a hung model and returns a failed/limit trace", async () => {
    const app = createServerAgentApplication({ newExecutionId: () => "timeout", registerTools: () => {},
      createModel: () => ({ generate: () => new Promise(() => {}) }), limits: { maxExecutionMs: 10 } });
    const result = await app.runAgentTurn(input);
    expect(["failed", "limit_reached"]).toContain(result.status);
    expect(result.trace.events.at(-1)?.type).toBe("task_completed");
  });
  it("records the exact safe budget reason without logging request or Tool input", async () => {
    const diagnostics: unknown[] = [];
    const app = createServerAgentApplication({ newExecutionId: () => "execution-1",
      limits: { maxToolCalls: 1 }, diagnostics: { record: async event => { diagnostics.push(event); } },
      createModel: () => ({ generate: async () => ({ ...call, message: { role: "assistant", content: [
        { type: "tool_call", name: "fake_tool", toolCallId: "call-1", input: {} },
        { type: "tool_call", name: "fake_tool", toolCallId: "call-2", input: {} },
      ] } }) }),
      registerTools: tools => tools.register({ name: "fake_tool", description: "fake", inputSchema: { type: "object", properties: {} },
        parseInput: validAgentToolInput, execute: async () => successfulAgentToolResult({ checked: true }) }),
    });
    expect((await app.runAgentTurn({ ...input, userRequest: "PRIVATE_MESSAGE" })).status).toBe("limit_reached");
    expect(diagnostics).toContainEqual(expect.objectContaining({ phase: "runtime", reason: "tool_budget", incomplete: true }));
    expect(JSON.stringify(diagnostics)).not.toContain("PRIVATE_MESSAGE");
  });
  it("validates principal and bounded input before constructing capabilities", async () => {
    const { app, execute, requests } = setup();
    await expect(app.runAgentTurn({ ...input, principal: fakePrincipal("") })).rejects.toThrow();
    await expect(app.runAgentTurn({ ...input, uiContext: { itemId: "a".repeat(201) } })).rejects.toThrow();
    await expect(app.runAgentTurn({ ...input, uiContext: { calendarDate: "2026-02-30" } })).rejects.toThrow();
    await expect(app.runAgentTurn({ ...input, userRequest: "a".repeat(8001) })).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled(); expect(requests).toEqual([]);
  });
  it("creates isolated capabilities for concurrent principals without promoting UI input to state", async () => {
    let id = 0;
    const scopes: unknown[] = [];
    const app = createServerAgentApplication({ newExecutionId: () => `turn-${++id}`,
      createModel: () => { let first = true; return { generate: async () => { if (first) { first = false; return call; } return final; } }; },
      registerTools: (tools, _evidence, scope) => {
        scopes.push(scope);
        tools.register({ name: "fake_tool", description: "fake", inputSchema: { type: "object", properties: {} },
          parseInput: validAgentToolInput, execute: async () => successfulAgentToolResult({ owner: scope.principal.subject }) });
      } });
    const results = await Promise.all(["owner-a", "owner-b"].map(subject => app.runAgentTurn({ ...input, principal: fakePrincipal(subject),
      uiContext: { itemId: "item-1", ownerId: "untrusted" } as { itemId: string } })));
    expect(results.map(result => result.status)).toEqual(["completed", "completed"]);
    expect(JSON.stringify(scopes)).not.toContain("untrusted");
    expect(JSON.stringify(results[0])).not.toContain("owner-b");
    expect(JSON.stringify(results[1])).not.toContain("owner-a");
  });
  it("accepts detailed research only for the exact Trip/revision-bound presentation receipt", async () => {
    const tripId = "11111111-1111-4111-8111-111111111111", presentationId = "22222222-2222-4222-8222-222222222222";
    const context = { taskContext: { version: 1 as const, phase: "refine" as const, availableProgressKinds: ["candidates" as const, "comparison" as const],
      target: { kind: "trip" as const, tripId, tripRevision: 4 } },
      workingState: { version: 1 as const, revision: 1, sourceTurnId: "33333333-3333-4333-8333-333333333333", sourceUserSequence: 1,
        target: { conversationId: "44444444-4444-4444-8444-444444444444", tripId, tripRevision: 4 }, presentations: [{ presentationId, version: 1 as const,
          target: { tripId, baseTripRevision: 4 }, candidateSetRef: { kind: "candidate-set-ref" as const, candidateSetId: "set-1", revision: 2, baseTripRevision: 4 }, entries: [{ ordinal: 1, candidateRef: "variant-1" }] }],
        pendingQuestionRefs: [], pendingProposalRefs: [] } };
    const app = createServerAgentApplication({ newExecutionId: () => "execution-1", createModel: () => ({ generate: async () => final }), registerTools: () => {},
      detailedResearchAllowed: true, detailedResearchLimits: { maxModelCalls: 2, maxIterations: 2 }, loadContext: async () => context });
    const target = { presentationId, candidateSetId: "set-1", candidateSetRevision: 2, tripId, baseTripRevision: 4 };
    expect((await app.runAgentTurn({ ...input, tripId, requestedResearchMode: "detailed", researchTarget: target })).status).toBe("completed");
    for (const changed of [{ ...target, baseTripRevision: 3 }, { ...target, tripId: "55555555-5555-4555-8555-555555555555" }, { ...target, candidateSetRevision: 3 }]) {
      await expect(app.runAgentTurn({ ...input, tripId, requestedResearchMode: "detailed", researchTarget: changed })).rejects.toThrow("Stale or foreign");
    }
  });
  it("rehydrates published Evidence without embedding its payload in model-visible Working State", async () => {
    const requests: AgentModelRequest[] = [];
    const response: AgentModelResponse = { message: { role: "assistant", content: [{ type: "text", text: "出典を説明します" }] }, stopReason: "completed",
      metadata: { provider: "fake", outputMode: "application_strict" }, declaredPresentation: { kind: "source-explanation",
        sections: [{ evidenceId: retainedSource.id, quote: retainedSource.facts.sourceExcerpt, mode: "feature" }] } };
    const workingState = { version: 1 as const, revision: 1, sourceTurnId: "33333333-3333-4333-8333-333333333333", sourceUserSequence: 1,
      target: { conversationId: "44444444-4444-4444-8444-444444444444" }, presentations: [], pendingQuestionRefs: [], pendingProposalRefs: [],
      groundingEvidence: [retainedSource] };
    const app = createServerAgentApplication({ newExecutionId: () => "execution-1", registerTools: () => {},
      loadContext: async () => ({ workingState }), createModel: () => ({ generate: async request => { requests.push(structuredClone(request)); return response; } }) });
    const result = await app.runAgentTurn(input);
    expect(result.status).toBe("completed");
    expect(result.evidence.map(({ id }) => id)).toEqual([retainedSource.id]);
    expect(JSON.stringify(requests[0]!.messages)).toContain("出雲市にある神社です");
    expect(JSON.stringify(requests[0]!.messages)).not.toContain("groundingEvidence");
    expect(requests[0]!.prompt?.dynamicSegments.some(({ kind }) => kind === "evidence")).toBe(true);
  });
});


it("accepts the #451 authentication wrapper without trusting a body principal", async () => {
  const { app, requests } = setup([final]);
  const verify = vi.fn(async () => fakePrincipal("verified-owner"));
  const execute = authenticatedApplication({ verify }, ["raiquora/user"],
    (principal, command: Omit<typeof input, "principal"> & { principal?: unknown }) => app.runAgentTurn({ ...command, principal }));
  await expect(execute(undefined, { userRequest: "hello" })).rejects.toThrow("unauthenticated");
  expect(requests).toHaveLength(0);
  expect((await execute("fake-token", { userRequest: "hello", principal: { subject: "forged" } })).status).toBe("completed");
  expect(verify).toHaveBeenCalledExactlyOnceWith("fake-token");
  expect(JSON.stringify(requests)).not.toMatch(/fake-token|forged|verified-owner/);
});
