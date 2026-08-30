import { expect, it } from "vitest";
import { BrowserContextWorkspaceRepository, contextWorkspaceStorageKey } from "./context-workspace-repository";

it("stores validated context views separately for each conversation", () => {
  const values = new Map<string, string>();
  const repository = new BrowserContextWorkspaceRepository({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  });
  repository.save({ version: 1, conversationSessionId: "a", view: "map" });
  repository.save({
    version: 1,
    conversationSessionId: "b",
    view: "trip-plan",
    entity: { kind: "trip-plan", id: "trip-b" },
  });
  expect(repository.find("a")?.view).toBe("map");
  expect(repository.find("b")?.entity?.id).toBe("trip-b");
  expect(values.get(contextWorkspaceStorageKey)).not.toContain("undefined");
});
