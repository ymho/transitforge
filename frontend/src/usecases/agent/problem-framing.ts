import type {
  AgentProblemFrame,
  AgentRuntimeRequest,
} from "./runtime-contract";
import type { AgentToolDescriptor } from "./tool-contract";
import {
  agentDecisionContextText,
  buildAgentDecisionContext,
} from "./agent-decision-context";

export interface AgentProblemFramer {
  frame(
    request: AgentRuntimeRequest,
    availableTools: AgentToolDescriptor[],
  ): AgentProblemFrame;
}

export class DefaultAgentProblemFramer implements AgentProblemFramer {
  frame(
    request: AgentRuntimeRequest,
    availableTools: AgentToolDescriptor[],
  ): AgentProblemFrame {
    const userRequest = request.userRequest.trim();
    const decisionContext = buildAgentDecisionContext(request, availableTools);
    return {
      feature: request.feature,
      normalizedIntent: "bedrock_decision_required",
      objective: agentDecisionContextText(decisionContext),
      constraints: Object.fromEntries(decisionContext.knownHardConstraints.map(
        ({ key, value }) => [key, value],
      )),
      missingInformation: userRequest ? [] : ["user_request"],
      decisionContext,
    };
  }
}
