import { randomUUID } from "node:crypto";
import type { TrustedPrincipal } from "../contracts/trusted-principal.js";
import { StateError, metadata, messageInputs, requireStatePrincipal, revision, stateId, pageOptions, type PageOptions } from "../contracts/server-state.js";
import type { ConversationRepository } from "../ports/conversation-repository.js";

/** Internal application only. Public transport must call through authenticatedApplication. */
export class ConversationApplication {
  constructor(private readonly repository: ConversationRepository, private readonly newId: () => string = randomUUID) {}
  async create(principal: TrustedPrincipal, input: unknown) {
    requireStatePrincipal(principal);
    return this.repository.create(principal, this.newId(), metadata(input));
  }
  async get(principal: TrustedPrincipal, conversationId: string) {
    requireStatePrincipal(principal); stateId(conversationId);
    const result = await this.repository.get(principal, conversationId);
    if (!result) throw new StateError("not-found");
    return result;
  }
  async list(principal: TrustedPrincipal, options: PageOptions = {}) {
    requireStatePrincipal(principal);
    return this.repository.list(principal, pageOptions(options));
  }
  async history(principal: TrustedPrincipal, conversationId: string, options: PageOptions = {}) {
    requireStatePrincipal(principal); stateId(conversationId);
    return this.repository.history(principal, conversationId, pageOptions(options));
  }
  async append(principal: TrustedPrincipal, conversationId: string, expectedRevision: number, input: unknown) {
    requireStatePrincipal(principal); stateId(conversationId); revision(expectedRevision);
    return this.repository.append(principal, conversationId, expectedRevision, messageInputs(input));
  }
  async update(principal: TrustedPrincipal, conversationId: string, expectedRevision: number, input: unknown) {
    requireStatePrincipal(principal); stateId(conversationId); revision(expectedRevision);
    return this.repository.update(principal, conversationId, expectedRevision, metadata(input));
  }
  async delete(principal: TrustedPrincipal, conversationId: string, expectedRevision: number) {
    requireStatePrincipal(principal); stateId(conversationId); revision(expectedRevision);
    return this.repository.delete(principal, conversationId, expectedRevision);
  }
}
