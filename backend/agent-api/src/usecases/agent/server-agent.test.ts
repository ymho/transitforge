import type { TrustedPrincipal } from "../../contracts/trusted-principal.js";
import { authenticatedApplication } from "../authenticated-application.js";
import { describe, expect, it, vi } from "vitest";
import type { ServerAgentRuntimeInput } from "../../ports/server-agent-runtime.js";
import { successfulAgentToolResult, validAgentToolInput } from "@raiquora/agent/tool-contract";
import { createServerAgentApplication } from "./server-agent.js";
import type { Evidence } from "@raiquora/agent/evidence-model";

function setup() {
  const requests: ServerAgentRuntimeInput[] = [];
  const execute = vi.fn(async () => successfulAgentToolResult({ checked: true }));
  const runRuntime = vi.fn(async (request: ServerAgentRuntimeInput) => {
    requests.push(request);
    return { status: "completed" as const, response: "こんにちは", evidence: [], claims: [],
      trace: { executionId: request.executionId, events: [], droppedEventCount: 0 } };
  });
  const app = createServerAgentApplication({ newExecutionId: () => "execution-1", runRuntime,
    registerTools: tools => tools.register({ name: "fake_tool", description: "fake", inputSchema: { type: "object", properties: {} },
      parseInput: value => validAgentToolInput(value), execute }),
  });
  return { app, requests, execute, runRuntime };
}
const fakePrincipal = (subject: string): TrustedPrincipal => ({ subject, identity: { issuer: "https://issuer.example.test", subject }, scopes: ["raiquora/user"] });
const input = { principal: fakePrincipal("fake-principal"), userRequest: "確認して" };
const retainedSource: Evidence = { id: "evidence:izumo", category: "external", knowledgeKind: "deterministic_fact", subject: "出雲大社",
  facts: { status: "available", freshness: "fresh", sourceTitle: "出雲大社", sourceExcerpt: "出雲市にある神社です。", sourceUrl: "https://example.test/izumo" },
  references: [{ sourceType: "external-source", sourceRef: "https://example.test/izumo", retrievedAt: "2026-09-24T00:00:00Z", freshness: "current", summary: "公式情報" }],
  observation: { observationId: "evidence:izumo", subjectKey: "place:izumo", scopeKey: "izumo", predicate: "place_description", retrievedAt: "2026-09-24T00:00:00Z",
    applicability: "applicable", retention: "bounded_excerpt" } };

describe("Server Agent Application without Browser APIs", () => {
  it("delegates the model/tool loop to an injected runtime through the required server runtime", async () => {
    const runRuntime = vi.fn(async ({ executionId }: Parameters<NonNullable<Parameters<typeof createServerAgentApplication>[0]["runRuntime"]>>[0]) => ({
      status: "completed" as const,
      response: "Strands runtime response",
      evidence: [],
      claims: [],
      trace: { executionId, events: [], droppedEventCount: 0 },
    }));
    const app = createServerAgentApplication({
      newExecutionId: () => "strands-execution",
      registerTools: tools => tools.register({ name: "read_only", description: "read", effect: "read",
        inputSchema: { type: "object", properties: {} }, parseInput: validAgentToolInput,
        execute: async () => successfulAgentToolResult({ ok: true }) }),
      runRuntime,
    });

    const result = await app.runAgentTurn(input);

    expect(result.status).toBe("completed");
    expect(result.response).toBe("Strands runtime response");
    expect(runRuntime).toHaveBeenCalledOnce();
    expect(runRuntime.mock.calls[0]?.[0].tools.descriptors().map(({ name }) => name)).toEqual(["read_only"]);
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
      runRuntime: async runtime => {
        const execution = await runtime.tools.execute("fake_tool", {}, { executionId: runtime.executionId, signal: new AbortController().signal });
        if (!execution.ok) throw new Error("Scoped tool failed");
        return { status: "completed", response: JSON.stringify(execution.output), evidence: [], claims: [],
          trace: { executionId: runtime.executionId, events: [], droppedEventCount: 0 } };
      },
      registerTools: (tools, _evidence, scope) => {
        scopes.push(scope);
        tools.register({ name: "fake_tool", description: "fake", inputSchema: { type: "object", properties: {} },
          parseInput: validAgentToolInput, execute: async () => successfulAgentToolResult({ owner: scope.principal.subject }) });
      } });
    const results = await Promise.all(["owner-a", "owner-b"].map(subject => app.runAgentTurn({ ...input, principal: fakePrincipal(subject),
      uiContext: { itemId: "item-1", ownerId: "untrusted" } as { itemId: string } })));
    expect(results.map(result => result.status)).toEqual(["completed", "completed"]);
    expect(results[0].response).toContain("owner-a");
    expect(results[1].response).toContain("owner-b");
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
    const app = createServerAgentApplication({ newExecutionId: () => "execution-1", runRuntime: setup().runRuntime, registerTools: () => {},
      detailedResearchAllowed: true, detailedResearchLimits: { maxModelCalls: 2, maxIterations: 2 }, loadContext: async () => context });
    const target = { presentationId, candidateSetId: "set-1", candidateSetRevision: 2, tripId, baseTripRevision: 4 };
    expect((await app.runAgentTurn({ ...input, tripId, requestedResearchMode: "detailed", researchTarget: target })).status).toBe("completed");
    for (const changed of [{ ...target, baseTripRevision: 3 }, { ...target, tripId: "55555555-5555-4555-8555-555555555555" }, { ...target, candidateSetRevision: 3 }]) {
      await expect(app.runAgentTurn({ ...input, tripId, requestedResearchMode: "detailed", researchTarget: changed })).rejects.toThrow("Stale or foreign");
    }
  });
  it("rehydrates published Evidence through the runtime input", async () => {
    const requests: ServerAgentRuntimeInput[] = [];
    const workingState = { version: 1 as const, revision: 1, sourceTurnId: "33333333-3333-4333-8333-333333333333", sourceUserSequence: 1,
      target: { conversationId: "44444444-4444-4444-8444-444444444444" }, presentations: [], pendingQuestionRefs: [], pendingProposalRefs: [],
      groundingEvidence: [retainedSource] };
    const app = createServerAgentApplication({ newExecutionId: () => "execution-1", registerTools: () => {},
      loadContext: async () => ({ workingState }), runRuntime: async request => {
        requests.push(request);
        return { status: "completed", response: "根拠を確認しました", evidence: request.initialEvidence ?? [], claims: [],
          trace: { executionId: request.executionId, events: [], droppedEventCount: 0 } };
      } });
    const result = await app.runAgentTurn(input);
    expect(result.status).toBe("completed");
    expect(result.evidence.map(({ id }) => id)).toEqual([retainedSource.id]);
    expect(requests[0].initialEvidence).toEqual([retainedSource]);
  });
});


it("accepts the #451 authentication wrapper without trusting a body principal", async () => {
  const { app, requests } = setup();
  const verify = vi.fn(async () => fakePrincipal("verified-owner"));
  const execute = authenticatedApplication({ verify }, ["raiquora/user"],
    (principal, command: Omit<typeof input, "principal"> & { principal?: unknown }) => app.runAgentTurn({ ...command, principal }));
  await expect(execute(undefined, { userRequest: "hello" })).rejects.toThrow("unauthenticated");
  expect(requests).toHaveLength(0);
  expect((await execute("fake-token", { userRequest: "hello", principal: { subject: "forged" } })).status).toBe("completed");
  expect(verify).toHaveBeenCalledExactlyOnceWith("fake-token");
  expect(requests[0].userRequest).toBe("hello");
  expect(requests[0]).not.toHaveProperty("principal");
});
