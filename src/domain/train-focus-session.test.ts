import { describe, expect, it } from "vitest";

import { TrainFocusSession } from "./train-focus-session";

describe("train focus session", () => {
  it("tracks the focused train until the session ends", () => {
    const session = new TrainFocusSession();

    session.start("service-1");
    expect(session.serviceUid).toBe("service-1");

    session.end();
    expect(session.serviceUid).toBeUndefined();
  });

  it("switches focus when another train is selected", () => {
    const session = new TrainFocusSession();

    session.start("service-1");
    session.start("service-2");

    expect(session.serviceUid).toBe("service-2");
  });
});
