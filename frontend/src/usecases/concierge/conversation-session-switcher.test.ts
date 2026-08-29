import { describe, expect, it, vi } from "vitest";
import type { ConversationSession } from "../../domain/conversation-session";
import type { ConversationSessionRepository } from "./conversation-session-repository";
import { createConversationSessionSwitcher } from "./conversation-session-switcher";

describe("conversation session switcher", () => {
  it("switches conversation and trip plan views after selecting a session", () => {
    const current = session("current");
    const selected = session("selected");
    const repository = repositoryStub(current, selected);
    const conversation = { switchSession: vi.fn() };
    const tripPlan = { switchSession: vi.fn() };
    const onActivated = vi.fn();

    const result = createConversationSessionSwitcher({
      repository,
      conversation,
      tripPlan,
      onActivated,
    }).activate(selected.id);

    expect(result).toEqual(selected);
    expect(repository.select).toHaveBeenCalledWith(selected.id);
    expect(onActivated).toHaveBeenCalledWith(selected);
    expect(conversation.switchSession).toHaveBeenCalledWith(selected.id);
    expect(tripPlan.switchSession).toHaveBeenCalledWith(selected.id);
  });

  it("reuses the already active replacement after deleting a session", () => {
    const replacement = session("replacement");
    const repository = repositoryStub(replacement, undefined);
    const conversation = { switchSession: vi.fn() };
    const tripPlan = { switchSession: vi.fn() };

    createConversationSessionSwitcher({
      repository,
      conversation,
      tripPlan,
      onActivated: vi.fn(),
    }).activate(replacement.id);

    expect(repository.select).not.toHaveBeenCalled();
    expect(conversation.switchSession).toHaveBeenCalledWith(replacement.id);
    expect(tripPlan.switchSession).toHaveBeenCalledWith(replacement.id);
  });
});

function session(id: string): ConversationSession {
  return {
    id,
    title: "会話",
    scope: "general",
    summary: "",
    resolvedTopics: [],
    pendingTopics: [],
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T00:00:00.000Z",
  };
}

function repositoryStub(
  active: ConversationSession,
  selected: ConversationSession | undefined,
): ConversationSessionRepository {
  return {
    list: vi.fn(() => [active]),
    active: vi.fn(() => active),
    create: vi.fn(),
    select: vi.fn(() => selected),
    rename: vi.fn(),
    save: vi.fn((value) => value),
    delete: vi.fn(() => active),
    subscribe: vi.fn(() => () => undefined),
  };
}
