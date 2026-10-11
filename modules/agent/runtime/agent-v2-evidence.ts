import { mergeEvidenceObservations, type Evidence, type EvidenceMergeResult } from "./evidence-model";
import type { EffectiveIntent } from "./effective-intent";
import { agentV2CandidateReferences, agentV2ReplyReferences } from "./agent-v2-publication";

/** One Application-owned view for Tool references, SDK admission and publication.
 * Research snippets must not consume the slots before publishable observations.
 * Keep acquisition order within each group: later reads cannot evict an earlier
 * offered reference unless its eligibility changes with the actual conditions. */
export function mergeAgentV2Evidence(
  evidence: readonly Evidence[], maximum?: number, effective?: EffectiveIntent,
): EvidenceMergeResult {
  const publishable: Evidence[] = [], research: Evidence[] = [];
  for (const item of evidence) {
    const eligible = agentV2ReplyReferences([item], effective).length > 0 ||
      agentV2CandidateReferences([item], effective).length > 0;
    (eligible ? publishable : research).push(item);
  }
  return mergeEvidenceObservations([], [...publishable, ...research], maximum);
}
