import type {
  AgentProblemFrame,
  AgentRuntimeRequest,
} from "./runtime-contract";

export interface AgentProblemFramer {
  frame(request: AgentRuntimeRequest): AgentProblemFrame;
}

export class DefaultAgentProblemFramer implements AgentProblemFramer {
  frame(request: AgentRuntimeRequest): AgentProblemFrame {
    const objective = request.userRequest.trim();
    return {
      feature: request.feature,
      normalizedIntent: intentFor(request.feature),
      objective,
      constraints: {},
      missingInformation: objective ? [] : ["user_request"],
    };
  }
}

function intentFor(feature: AgentRuntimeRequest["feature"]): string {
  switch (feature) {
    case "journey_planning":
      return "plan_journey";
    case "train_guidance":
      return "guide_train";
    case "operational_analysis":
      return "analyze_operation";
    case "travel_planning":
      return "plan_travel";
  }
}
