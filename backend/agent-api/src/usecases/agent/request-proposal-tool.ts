import { randomUUID } from "node:crypto";
import { applyTripProposal } from "@raiquora/trip/trip";
import { proposeReviewedRequestChanges, type ReviewedRequestChange } from "@raiquora/trip/reviewed-request-changes";
import { requestChangesDescriptor } from "@raiquora/agent/request-changes-descriptor";
import type { Trip } from "@raiquora/trip/trip";
import type { TripRequest } from "@raiquora/trip/trip-request";
import { proposeModelRequest } from "@raiquora/trip/model-request-proposal";
import { parsePublicRequestProposal, type PublicRequestProposal } from "@raiquora/trip/public-request-proposal";
import { requestAssumptionsDescriptor } from "@raiquora/agent/request-assumptions-descriptor";
import { validateAgentToolInput } from "@raiquora/agent/agent-tool-input-validator";
import { successfulAgentToolResult, failedAgentToolResult } from "@raiquora/agent/tool-contract";
import type { AgentToolRegistry } from "@raiquora/agent/tool-registry";

/** No writes: immutable authorized snapshot determines target/revision, never model input. */
export function registerRequestProposalTool(tools: AgentToolRegistry, trip: Trip, publish: (proposal: PublicRequestProposal) => void) {
  const base = structuredClone(trip);
  let preview = base;
  for (const descriptor of [requestAssumptionsDescriptor, requestChangesDescriptor]) {
    tools.register<Record<string, unknown>, unknown>({ ...descriptor,
      parseInput: value => validateAgentToolInput(descriptor.inputSchema, value),
      async execute(input) {
        try {
          const next = descriptor.name === requestAssumptionsDescriptor.name
            ? proposeModelRequest(preview, input.request as TripRequest)
            : proposeReviewedRequestChanges(preview, input.changes as ReviewedRequestChange[], randomUUID);
          const proposal = parsePublicRequestProposal(next);
          const after = applyTripProposal(base, proposal);
          publish(proposal);
          preview = after;
          return successfulAgentToolResult({ proposed: true, summary: proposal.summary, proposedRequest: preview.request, saved: false, confirmationRequired: true });
        } catch {
          return failedAgentToolResult({ code: "precondition_failed", message: "現在の条件ID・型・値を確認してください。新規仮定はpropose_request_assumptions、既知条件の変更はpropose_request_changesを使います。保存は利用者の確認後です。", retryable: false });
        }
      },
    });
  }
}
