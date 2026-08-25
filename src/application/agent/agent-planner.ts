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
        `依頼を${problem.normalizedIntent}として整理する`,
        availableTools.length > 0
          ? "必要なDomain Toolを選び順序付きで実行する"
          : "利用可能な情報だけで回答可否を判断する",
        "Evidenceと情報不足を確認する",
        "根拠の範囲内で回答する",
      ],
    };
  }
}
