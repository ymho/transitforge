import {
  isContextWorkspaceState,
  type ContextWorkspaceState,
} from "../../domain/context-workspace";
import type { ContextWorkspaceRepository } from "../../usecases/context-workspace/context-workspace-repository";

export const contextWorkspaceStorageKey = "raiquora.context-workspaces.v1";
const maximumStoredSessions = 20;

export class BrowserContextWorkspaceRepository implements ContextWorkspaceRepository {
  constructor(private readonly storage: Pick<Storage, "getItem" | "setItem">) {}

  find(conversationSessionId: string): ContextWorkspaceState | undefined {
    return this.read().find((state) =>
      state.conversationSessionId === conversationSessionId);
  }

  save(state: ContextWorkspaceState): void {
    const remaining = this.read().filter((candidate) =>
      candidate.conversationSessionId !== state.conversationSessionId);
    this.write([state, ...remaining].slice(0, maximumStoredSessions));
  }

  delete(conversationSessionId: string): void {
    this.write(this.read().filter((state) =>
      state.conversationSessionId !== conversationSessionId));
  }

  private read(): ContextWorkspaceState[] {
    try {
      const value = JSON.parse(this.storage.getItem(contextWorkspaceStorageKey) ?? "[]");
      return Array.isArray(value) ? value.filter(isContextWorkspaceState) : [];
    } catch {
      return [];
    }
  }

  private write(states: ContextWorkspaceState[]): void {
    this.storage.setItem(contextWorkspaceStorageKey, JSON.stringify(states));
  }
}
