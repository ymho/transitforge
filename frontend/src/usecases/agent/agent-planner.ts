import type { AgentToolDescriptor } from "./tool-contract";
import type { AgentPlan, AgentProblemFrame } from "./runtime-contract";

export interface AgentPlanner {
  createPlan(
    problem: AgentProblemFrame,
    availableTools: AgentToolDescriptor[],
  ): AgentPlan;
}

export class DefaultAgentPlanner implements AgentPlanner {
  createPlan(
    problem: AgentProblemFrame,
    availableTools: AgentToolDescriptor[],
  ): AgentPlan {
    if (problem.missingInformation.length > 0) {
      return { steps: ["不足情報を利用者へ確認する"] };
    }
    return {
      steps: [
        "構造化Contextから目的 制約 嗜好 未解決事項をBedrockが判断する",
        availableTools.length > 0
          ? "Bedrockが能力contractから次のTool 質問 回答を選択する"
          : "Bedrockが既知Contextだけで質問または回答を選択する",
        "決定論的なEvidence Policyと安全制約で結果を検証する",
      ],
    };
  }
}
