import type { ContextWorkspaceState } from "../../domain/context-workspace";

export interface ContextWorkspaceRepository {
  find(conversationSessionId: string): ContextWorkspaceState | undefined;
  save(state: ContextWorkspaceState): void;
  delete(conversationSessionId: string): void;
}
