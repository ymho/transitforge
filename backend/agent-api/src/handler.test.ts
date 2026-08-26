import { describe, expect, it, vi } from "vitest";

import { AgentApplication } from "./usecases/agent-application.js";
import { createAgentApiHandler } from "./handler.js";

describe("TypeScript Agent API handler", () => {
  it("dispatches an operation without AWS SDK or Terraform", async () => {
    const journeySearch = vi.fn(async () => ({ body: { journeys: [] } }));
    const defaultOperation = vi.fn(async () => ({ body: { stopReason: "end_turn" } }));
    const handler = createAgentApiHandler(new AgentApplication({
      defaultOperation,
      operations: new Map([["journey_search", journeySearch]]),
    }));

    const response = await handler(post({ operation: "journey_search" }), {
      awsRequestId: "request-1",
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ journeys: [] });
    expect(response.headers).toEqual({
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-transitforge-request-id": "request-1",
    });
    expect(journeySearch).toHaveBeenCalledWith(
      { operation: "journey_search" },
      { requestId: "request-1" },
    );
    expect(defaultOperation).not.toHaveBeenCalled();
  });

  it("uses the default operation when operation is absent", async () => {
    const defaultOperation = vi.fn(async () => ({
      body: { stopReason: "end_turn" },
    }));
    const handler = createAgentApiHandler(new AgentApplication({ defaultOperation }));
    const request = {
      messages: [{ role: "user", content: [{ text: "京都へ行きたい" }] }],
    };

    const response = await handler(post(request), { aws_request_id: "request-2" });

    expect(response.statusCode).toBe(200);
    expect(defaultOperation).toHaveBeenCalledWith(request, { requestId: "request-2" });
  });

  it("returns a no-store request-id error without calling the application", async () => {
    const execute = vi.fn();
    const handler = createAgentApiHandler({ execute }, { requestId: () => "generated-id" });
    const response = await handler({ requestContext: { http: { method: "GET" } } });

    expect(response.statusCode).toBe(405);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-transitforge-request-id"]).toBe("generated-id");
    expect(JSON.parse(response.body)).toEqual({ message: "POSTのみ利用できます。" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("does not expose unexpected failures", async () => {
    const log = vi.fn();
    const handler = createAgentApiHandler({
      execute: async () => { throw new Error("secret value"); },
    }, { requestId: () => "request-3", log });

    const response = await handler(post({ operation: "agent_trace" }));

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain("secret value");
    expect(log).toHaveBeenCalledWith("agent_request_failed", {
      requestId: "request-3",
      statusCode: 500,
    });
  });
});

function post(body: Record<string, unknown>) {
  return {
    requestContext: { http: { method: "POST" } },
    body: JSON.stringify(body),
  };
}
