import type { AgentDecisionContext } from "./agent-decision-context";
import type { CompiledPrompt } from "./model-provider";
import { stableContractHash } from "./output-contract";
import type { AgentToolDescriptor } from "./tool-contract";

export interface CompileAgentPromptInput {
  context: AgentDecisionContext;
  tools: readonly AgentToolDescriptor[];
  outputSchema: Record<string, unknown>;
  renderedContext: string;
  maximumCharacters?: number;
}

/**
 * Produces a manifest, not another state store. Raw request/private state stays in the
 * dynamic message assembled by the runtime and can never enter a shared stable prefix.
 */
export function compileAgentPrompt(input: CompileAgentPromptInput): CompiledPrompt {
  const maximum = input.maximumCharacters ?? 32_000;
  if (input.context.userRequest.length > maximum) throw new Error("Agent request exceeds prompt budget");
  if (!input.renderedContext.includes(JSON.stringify(input.context.userRequest))) {
    throw new Error("Compiled prompt lost the current user request");
  }
  const omittedScopes: string[] = [];
  if (input.context.currentTrip && input.context.currentTrip.scheduleTruncated === true) omittedScopes.push("trip.items");
  const dynamicSegments: CompiledPrompt["dynamicSegments"] = [
    { kind: "request", ref: `request:${stableContractHash(input.context.userRequest)}` },
    ...(input.context.workingState ? [{ kind: "working_state" as const, ref: `working:${input.context.workingState.revision}` }] : []),
    ...(input.context.currentTrip ? [{ kind: "trip" as const, ref: tripRef(input.context.currentTrip) }] : []),
    ...(input.context.verifiedFacts.length ? [{ kind: "evidence" as const, ref: `evidence:${stableContractHash(input.context.verifiedFacts.map(f => f.evidenceId))}` }] : []),
  ];
  return {
    contractVersion: "compiled-prompt-v1",
    stableSegments: [
      { kind: "system", version: "server-agent-system-v1", hash: stableContractHash("server-agent-system-v1") },
      { kind: "tools", version: "tool-contract-v1", hash: stableContractHash(input.tools.map(tool => ({ name: tool.name, description: tool.description, schema: tool.inputSchema }))) },
      { kind: "schema", version: "agent-turn-output-v1", hash: stableContractHash(input.outputSchema) },
    ],
    dynamicSegments,
    coverage: {
      status: omittedScopes.length ? "partial" : "complete",
      includedScopes: ["current_request", ...(input.context.currentTrip ? ["trip.summary"] : []), ...(input.context.verifiedFacts.length ? ["evidence.selected"] : [])],
      omittedScopes,
    },
    omissionManifest: omittedScopes.map(scope => ({ scope, reason: "not_loaded" as const })),
    cacheIntent: { enabled: true, checkpoint: input.tools.length ? "tools" : "system", ttlSeconds: 300 },
  };
}

function tripRef(trip: Record<string, unknown>): string {
  const id = typeof trip.id === "string" ? trip.id : "selected";
  const revision = Number.isSafeInteger(trip.sourceRevision) ? trip.sourceRevision : Number.isSafeInteger(trip.revision) ? trip.revision : "unknown";
  return `trip:${id}@${revision}`;
}
