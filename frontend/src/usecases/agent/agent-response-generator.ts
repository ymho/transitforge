import type { Evidence, EvidenceClaim } from "./evidence-model";
import type { AgentModelResponse } from "./model-provider";
import type { ViewerAgentAction } from "../viewer/viewer-action";
import { parseGroundedAnswer, presentGroundedEvidence, supportedAnswerClaims, sourceExplanation } from "./grounded-answer";

export interface AgentGeneratedResponse {
  text: string;
  claims: EvidenceClaim[];
  viewerActions: ViewerAgentAction[];
}

export interface AgentResponseGenerator {
  followUp(missingInformation: string[]): string;
  fromModel(response: AgentModelResponse, evidence: Evidence[], origin?: "interaction" | "administrative" | "grounded", profile?: Record<string, unknown>): AgentGeneratedResponse;
  limitReached(hasEvidence?: boolean): string;
  failure(): string;
  groundingFailure(): string;
}

export class DefaultAgentResponseGenerator implements AgentResponseGenerator {
  followUp(missingInformation: string[]): string {
    if (missingInformation.includes("user_request")) {
      return "調べたいことや実現したいことを教えてください";
    }
    return `確認したいことがあります: ${missingInformation.join(" ")}`;
  }

  fromModel(response: AgentModelResponse, evidence: Evidence[], origin: "interaction" | "administrative" | "grounded" = "grounded", profile?: Record<string, unknown>): AgentGeneratedResponse {
    const text = response.message.content
      .filter((content): content is { type: "text"; text: string } =>
        content.type === "text")
      .map(({ text }) => withoutInternalReasoning(text).trim())
      .filter(Boolean)
      .join("\n");
    if (origin === "grounded" || evidence.some((e) => Object.keys(e.facts).length > 0) || text.startsWith("{")) {
      const ids = response.decisionSummary?.usedEvidenceIds ?? response.declaredEvidenceIds;
      if (!text.startsWith("{") && !response.invalidUsedEvidenceIds && ids?.length) return presentGroundedEvidence(ids, evidence);
      if (!text.startsWith("{") && !response.invalidUsedEvidenceIds && ids?.length === 0) {
        // Explicitly selecting no factual support never licenses the model's prose.
        // Preserve uncertainty with the existing unknown Claim contract instead.
        const claims = supportedAnswerClaims([]);
        return { text: claims[0]!.statement, claims, viewerActions: [] };
      }
      return sourceExplanation(text, evidence, profile) ?? parseGroundedAnswer(text, evidence);
    }
    // Output validation, not input intent routing: no first-turn lane may publish
    // concrete transport measurements without a bound Claim. Native question and
    // deterministic Tool presenters do not use this free-prose lane.
    if (origin === "interaction" && /[0-9０-９一二三四五六七八九十百]+\s*(?:[:：][0-9０-９]{2}|分|時間|時|円|km|キロ|番線|号)/iu.test(text)) {
      throw new Error("Unbound concrete value in interaction");
    }
    return {
      text: text || "確認できる情報が不足しているため回答できません",
      claims: [],
      viewerActions: [],
    };
  }

  limitReached(hasEvidence = false): string {
    return hasEvidence
      ? "確認できた情報だけでは結論を確定できませんでした。これまでの条件は保持しています。優先したい条件を一つ教えていただければ、そこから続けます。"
      : "今回は必要な情報を確認しきれませんでした。これまでの条件は保持しています。別の候補を探すか、条件を一つ変えて続けられます。";
  }

  failure(): string {
    return "案内を完了できませんでした。時間をおいてもう一度お試しください";
  }

  groundingFailure(): string {
    return "確認できた根拠だけでは回答できません";
  }
}

export function hasOnlyInternalReasoning(response: AgentModelResponse): boolean {
  const textBlocks = response.message.content.filter(
    (content): content is { type: "text"; text: string } => content.type === "text",
  );
  return textBlocks.length > 0 && textBlocks.every(({ text }) =>
    text.trim().length > 0 && withoutInternalReasoning(text).trim().length === 0);
}

function withoutInternalReasoning(value: string): string {
  return value.replace(/<(thinking|analysis)>[\s\S]*?<\/\1>/giu, "");
}
