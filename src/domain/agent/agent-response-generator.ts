import type { Evidence } from "./evidence-model";
import type { AgentModelResponse } from "./model-provider";
import type { AgentProblemFrame } from "./runtime-contract";

export interface AgentResponseGenerator {
  followUp(problem: AgentProblemFrame): string;
  fromModel(response: AgentModelResponse, evidence: Evidence[]): string;
  limitReached(): string;
  failure(): string;
}

export class DefaultAgentResponseGenerator implements AgentResponseGenerator {
  followUp(problem: AgentProblemFrame): string {
    if (problem.missingInformation.includes("user_request")) {
      return "調べたいことや実現したいことを教えてください";
    }
    return `確認したいことがあります: ${problem.missingInformation.join(" ")}`;
  }

  fromModel(response: AgentModelResponse, _evidence: Evidence[]): string {
    const text = response.message.content
      .filter((content): content is { type: "text"; text: string } =>
        content.type === "text")
      .map(({ text }) => text.trim())
      .filter(Boolean)
      .join("\n");
    return text || "確認できる情報が不足しているため回答できません";
  }

  limitReached(): string {
    return "安全な実行上限に達したため案内を完了できませんでした";
  }

  failure(): string {
    return "案内を完了できませんでした。時間をおいてもう一度お試しください";
  }
}
