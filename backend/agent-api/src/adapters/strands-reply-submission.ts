import { AgentV2ReplyError, parseAgentV2Reply, type AgentV2ReplyProposal } from "@raiquora/agent/agent-v2-reply";

/** Invocation-local draft, not persistent memory or a write receipt. The model may
 * submit one reply; neither later text nor another submission can replace it. */
export class AgentV2ReplySubmission {
  private proposal?: AgentV2ReplyProposal;
  get submitted(): boolean { return this.proposal !== undefined; }
  receive(value: unknown): { ok: boolean; code?: string } {
    if (this.submitted) return { ok: false, code: "already_submitted" };
    try { this.proposal = parseAgentV2Reply(value); return { ok: true }; }
    catch (error) {
      if (error instanceof AgentV2ReplyError) return { ok: false, code: error.code };
      throw error;
    }
  }
  snapshot(): AgentV2ReplyProposal | undefined { return this.proposal ? structuredClone(this.proposal) : undefined; }
}
