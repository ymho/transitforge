import {
  contextWorkspaceState,
  defaultContextWorkspaceState,
  type ContextEntityReference,
  type ContextViewKind,
  type ContextWorkspaceState,
} from "../../domain/context-workspace";
import type { ContextWorkspaceRepository } from "./context-workspace-repository";

export interface ContextWorkspaceController {
  current(): ContextWorkspaceState;
  activateSession(conversationSessionId: string): ContextWorkspaceState;
  show(view: ContextViewKind, entity?: ContextEntityReference): boolean;
  subscribe(listener: (state: ContextWorkspaceState) => void): () => void;
}

export function createContextWorkspaceController(
  initialConversationSessionId: string,
  repository: ContextWorkspaceRepository,
): ContextWorkspaceController {
  let state = repository.find(initialConversationSessionId) ??
    defaultContextWorkspaceState(initialConversationSessionId);
  const listeners = new Set<(state: ContextWorkspaceState) => void>();
  const publish = () => {
    repository.save(state);
    for (const listener of listeners) listener(structuredClone(state));
  };
  return {
    current: () => structuredClone(state),
    activateSession(conversationSessionId) {
      state = repository.find(conversationSessionId) ??
        defaultContextWorkspaceState(conversationSessionId);
      publish();
      return structuredClone(state);
    },
    show(view, entity) {
      const next = contextWorkspaceState(
        state.conversationSessionId,
        view,
        entity,
      );
      if (!next) return false;
      state = next;
      publish();
      return true;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
