/** Public Application observations only: never Trace, reasoning, Tool input/output or provider text. */
export const agentProgressPhases = ["running", "understanding_request", "checking_information", "comparing_options", "building_answer", "validating_answer"] as const;
export type AgentProgressPhase = typeof agentProgressPhases[number];
export type AgentProgressReporter = (phase: AgentProgressPhase) => Promise<void>;
export type AgentTurnEvent =
  | { type: "progress"; phase: AgentProgressPhase }
  | { type: "intent_accepted"; receipt: import("./public-semantic-receipt").PublicSemanticReceipt }
  | { type: "final"; status: "completed" | "follow_up"; response: string; semanticReceipt?: import("./public-semantic-receipt").PublicSemanticReceipt; publicPlanPresentation?: import("./public-plan-presentation").PublicPlanPresentation; publicJourneyPresentation?: import("./public-journey-presentation").PublicJourneyPresentation; researchExecution?: import("./research-execution").ResearchExecutionOutcome; tripUpdateProposal?: import("@raiquora/trip/public-request-proposal").PublicRequestProposal; consultationRequestProposal?: import("@raiquora/trip/consultation-request-proposal").ConsultationRequestProposal; tripCostProposal?: import("@raiquora/trip/public-cost-proposal").PublicCostProposal }
  | { type: "error"; code: "agent_failed" | "limit_reached" | "turn_conflict" };
export type AgentTurnEventSink = (event: AgentTurnEvent) => Promise<void>;
