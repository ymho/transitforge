import { describe, expect, it } from "vitest";
import { TrainFocusReturnContextSession } from "./train-focus-return-context";

describe("TrainFocusReturnContextSession", () => {
  it("keeps the context from before focus across train redraws", () => {
    const session = new TrainFocusReturnContextSession();
    session.start({ version: 1, conversationSessionId: "a", view: "map" }, true);
    session.start({ version: 1, conversationSessionId: "a", view: "journey-details", entity: { kind: "journey", id: "train" } }, true);

    expect(session.end()).toEqual({
      workspace: { version: 1, conversationSessionId: "a", view: "map" },
      mobileContextOpen: true,
    });
    expect(session.end()).toBeUndefined();
  });

  it("remembers when focus started from the conversation", () => {
    const session = new TrainFocusReturnContextSession();
    session.start({ version: 1, conversationSessionId: "a", view: "map" }, false);
    expect(session.end()?.mobileContextOpen).toBe(false);
  });
});
