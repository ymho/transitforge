import { costForecastDescriptor } from "@raiquora/agent/cost-forecast-descriptor";
import { validateAgentToolInput } from "@raiquora/agent/agent-tool-input-validator";
import { failedAgentToolResult, successfulAgentToolResult } from "@raiquora/agent/tool-contract";
import type { AgentToolRegistry } from "@raiquora/agent/tool-registry";
import { applyTripProposal, type Trip } from "@raiquora/trip/trip";
import { parsePublicCostProposal, type PublicCostProposal } from "@raiquora/trip/public-cost-proposal";
export function registerCostProposalTool(tools: AgentToolRegistry, trip: Trip, publish: (proposal: PublicCostProposal) => void, now = () => new Date()) {
  const base = structuredClone(trip);
  tools.register<Record<string, unknown>, unknown>({ ...costForecastDescriptor,
    parseInput: value => validateAgentToolInput(costForecastDescriptor.inputSchema, value),
    async execute(input) {
      try {
        const proposal = parsePublicCostProposal({ tripId: base.id, baseRevision: base.revision, summary: "旅行全体・利用者全員分のAI概算", patches: [{ type: "cost_forecast", forecast: {
          tripId: base.id, baseRevision: base.revision, generatedAt: now().toISOString(), items: input.items,
        } }] });
        const unknownBasis = !base.request.party || base.request.party.source === "assumption" ||
          (!base.request.constraints.some(c => ["dates", "duration"].includes(c.requirement.type)) && base.items.every(i => i.schedule.type === "unscheduled"));
        if (unknownBasis && proposal.patches[0].forecast.items.some(item => item.amount !== undefined && !item.assumptions.length)) throw new Error("Missing assumptions");
        applyTripProposal(base, proposal); publish(proposal);
        return successfulAgentToolResult({ proposed: true, saved: false, confirmationRequired: true, description: "AIによる概算です。予約価格や価格保証ではありません。ユーザー編集は保持します。" });
      } catch { return failedAgentToolResult({ code: "precondition_failed", message: "4カテゴリと通貨・最小単位・前提を確認してください。推定不能は金額を省略します。", retryable: false }); }
    },
  });
}
