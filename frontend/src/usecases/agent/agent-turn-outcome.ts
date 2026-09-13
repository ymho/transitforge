/** Execution observations, never Trip/planning state or a persistent conversation workflow. */
export type AgentTurnOutcome = "ask_only" | "ask_and_progress" | "progress" | "answer";
export interface AskOnlyException {
  reason: "safety" | "hard_constraint_unknown" | "tool_input_missing";
  /** External, reviewable missing fact; not reasoning or Chain-of-Thought. */
  missingFact: string;
  constraintId?: string;
  toolName?: string;
  inputName?: string;
}
export interface VisibleProgress {
  kind: "candidates" | "comparison" | "trip_proposal" | "itinerary" | "grounded_decision" | "checklist_proposal";
  refs: string[];
}
export interface AgentTurnObservation {
  outcome: AgentTurnOutcome;
  progress: VisibleProgress[];
  exception?: AskOnlyException;
}

/** The presenter supplies actual visible artifacts, not a model's progress=true assertion. */
export function observeAgentTurn(hasQuestion: boolean, progress: VisibleProgress[], exception?: AskOnlyException): AgentTurnObservation {
  const visible = progress.map((p) => ({ kind: p.kind, refs: [...new Set(p.refs.filter((ref) => ref.trim()))].slice(0, 12) }))
    .filter((p) => p.refs.length > 0);
  return { outcome: hasQuestion ? visible.length ? "ask_and_progress" : "ask_only" : visible.length ? "progress" : "answer",
    progress: visible, ...(hasQuestion && exception ? { exception } : {}) };
}

export function acceptsAgentTurn(previous: AgentTurnOutcome | undefined, current: AgentTurnObservation): boolean {
  return previous !== "ask_only" || current.outcome !== "ask_only" || current.exception !== undefined;
}

export const askProgressRepairInstruction = "直前も質問だけでした。既知のRequestと今回確認した結果を使い、候補・比較・検証可能な変更案など利用者に見える進展を質問と併記してください。内部Tool実行や条件整理だけは進展ではありません。安全、未確認hard条件、Tool必須入力の不足で質問を優先する場合だけaskOnlyExceptionに外部化可能な不足事項を示してください。Toolや順序は自分で判断し、事実は捏造しないでください。";

/** Bounded tab-lifetime observation cache. Switching sessions never mixes turns; reload starts unknown. */
export function createAgentTurnObservationStore(maximumSessions = 20) {
  const values = new Map<string, AgentTurnOutcome>();
  return {
    get: (sessionId: string) => values.get(sessionId),
    record(sessionId: string, observation: AgentTurnObservation) {
      values.delete(sessionId);
      values.set(sessionId, observation.outcome);
      if (values.size > maximumSessions) values.delete(values.keys().next().value!);
    },
  };
}
