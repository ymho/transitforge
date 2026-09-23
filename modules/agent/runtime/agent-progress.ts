/** Public Application observations only: never Trace, reasoning, Tool input/output or provider text. */
export type AgentTurnEvent =
  | { type: "progress"; phase: "running" }
  | { type: "final"; status: "completed" | "follow_up"; response: string; publicPlanPresentation?: import("./public-plan-presentation").PublicPlanPresentation; tripUpdateProposal?: import("@raiquora/trip/public-request-proposal").PublicRequestProposal; consultationRequestProposal?: import("@raiquora/trip/consultation-request-proposal").ConsultationRequestProposal; tripCostProposal?: import("@raiquora/trip/public-cost-proposal").PublicCostProposal }
  | { type: "error"; code: "agent_failed" | "limit_reached" | "turn_conflict" };
export type AgentTurnEventSink = (event: AgentTurnEvent) => Promise<void>;
