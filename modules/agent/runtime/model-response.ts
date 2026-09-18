import { extractAgentDecisionSummary } from "./agent-decision-summary";
import type { AgentModelContent, AgentModelResponse } from "./model-provider";

/** Keep optional model decision metadata out of both presentation and subsequent text blocks. */
export function withAgentDecisionSummary(response: AgentModelResponse): AgentModelResponse {
  const decision = extractAgentDecisionSummary(response.message.content.flatMap(content => content.type === "text" ? [content.text] : []));
  let textIndex = 0;
  const content = response.message.content.reduce<AgentModelContent[]>((blocks, block) => {
    if (block.type !== "text") blocks.push(block);
    else {
      const text = decision.textBlocks[textIndex++] ?? "";
      if (text.length > 0) blocks.push({ ...block, text });
    }
    return blocks;
  }, []);
  return { ...response, message: { ...response.message, content }, decisionSummaryStatus: decision.status,
    ...(decision.declaredInTripAnswerPlan ? { declaredInTripAnswerPlan: decision.declaredInTripAnswerPlan } : {}),
    ...(decision.invalidUsedEvidenceIds ? { invalidUsedEvidenceIds: true } : {}),
    ...(decision.declaredEvidenceIds ? { declaredEvidenceIds: decision.declaredEvidenceIds } : {}),
    ...(decision.summary ? { decisionSummary: decision.summary } : {}),
  };
}
