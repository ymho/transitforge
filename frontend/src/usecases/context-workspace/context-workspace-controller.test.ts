import { describe, expect, it } from "vitest";
import type { ContextWorkspaceState } from "../../domain/context-workspace";
import type { ContextWorkspaceRepository } from "./context-workspace-repository";
import { createContextWorkspaceController } from "./context-workspace-controller";

class MemoryRepository implements ContextWorkspaceRepository {
  readonly states = new Map<string, ContextWorkspaceState>();
  find(id: string) { return this.states.get(id); }
  save(state: ContextWorkspaceState) {
    this.states.set(state.conversationSessionId, structuredClone(state));
  }
  delete(id: string) { this.states.delete(id); }
}

describe("context workspace controller", () => {
  it("restores each conversation session without recreating view resources", () => {
    const repository = new MemoryRepository();
    const controller = createContextWorkspaceController("session-a", repository);
    expect(controller.show("trip-plan", { kind: "trip-plan", id: "trip-a" })).toBe(true);
    controller.activateSession("session-b");
    expect(controller.current().view).toBe("map");
    controller.activateSession("session-a");
    expect(controller.current()).toMatchObject({
      view: "trip-plan",
      entity: { kind: "trip-plan", id: "trip-a" },
    });
  });

  it("does not publish an invalid target for a context view", () => {
    const repository = new MemoryRepository();
    const controller = createContextWorkspaceController("session-a", repository);
    const observed: ContextWorkspaceState[] = [];
    controller.subscribe((state) => observed.push(state));
    expect(controller.show("journey-details", { kind: "place", id: "poi" })).toBe(false);
    expect(observed).toEqual([]);
    expect(controller.current().view).toBe("map");
  });
});
