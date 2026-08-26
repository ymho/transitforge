import { describe, expect, it, vi } from "vitest";

import { AgentApplication } from "./agent-application.js";

describe("AgentApplication", () => {
  it("logs bounded operation metadata without request content", async () => {
    const log = vi.fn();
    const now = vi.fn()
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(125);
    const application = new AgentApplication({
      defaultOperation: async () => ({ body: { ok: true } }),
      now,
      log,
    });

    await expect(application.execute({
      messages: [{ role: "user", content: [{ text: "secret" }] }],
    }, "request-1"))
      .resolves.toEqual({ body: { ok: true } });
    expect(log).toHaveBeenNthCalledWith(1, "agent_request_started", {
      requestId: "request-1",
      operation: "bedrock_converse",
    });
    expect(log).toHaveBeenNthCalledWith(2, "agent_request_completed", {
      requestId: "request-1",
      operation: "bedrock_converse",
      statusCode: 200,
      durationMs: 25,
    });
  });
});
