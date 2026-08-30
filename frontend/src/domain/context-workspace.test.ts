import { describe, expect, it } from "vitest";
import {
  contextWorkspaceState,
  defaultContextWorkspaceState,
  isContextWorkspaceState,
} from "./context-workspace";

describe("context workspace state", () => {
  it("starts a conversation session on the map without an invented target", () => {
    expect(defaultContextWorkspaceState("session-a")).toEqual({
      version: 1,
      conversationSessionId: "session-a",
      view: "map",
    });
  });

  it("accepts only entities that belong to the selected context view", () => {
    expect(contextWorkspaceState("session-a", "trip-plan", {
      kind: "trip-plan",
      id: "trip-a",
    })).toBeDefined();
    expect(contextWorkspaceState("session-a", "trip-plan", {
      kind: "train",
      id: "1001M",
    })).toBeUndefined();
  });

  it("rejects untrusted persisted values", () => {
    expect(isContextWorkspaceState({
      version: 1,
      conversationSessionId: "session-a",
      view: "journey-details",
      entity: { kind: "place", id: "poi" },
    })).toBe(false);
  });
});
