import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import {
  allowedToolNames,
  maximumBodyBytes,
  RequestError,
  requestValue,
  validatedMessages,
  validatedModelClass,
  validatedToolDefinitions,
} from "./agent-request.js";

describe("Agent API request contract", () => {
  it("accepts plain and base64 encoded JSON objects", () => {
    const body = JSON.stringify({ operation: "journey_search" });
    expect(requestValue(event(body))).toEqual({ operation: "journey_search" });
    expect(requestValue({
      ...event(Buffer.from(body).toString("base64")),
      isBase64Encoded: true,
    })).toEqual({ operation: "journey_search" });
  });

  it("keeps Python-compatible HTTP rejection boundaries", () => {
    expectRequestError(
      () => requestValue({ requestContext: { http: { method: "GET" } } }),
      405,
      "POSTのみ利用できます。",
    );
    expectRequestError(() => requestValue(event("not-json")), 400);
    expectRequestError(
      () => requestValue(event("a".repeat(maximumBodyBytes + 1))),
      413,
    );
    expectRequestError(
      () => requestValue({ ...event("?"), isBase64Encoded: true }),
      400,
      "リクエスト本文を読み取れません。",
    );
  });

  it("accepts only bounded relay conversation blocks", () => {
    const messages = validatedMessages({
      messages: [
        {
          role: "assistant",
          content: [{
            toolUse: {
              toolUseId: "tool-1",
              name: "search_journeys",
              input: { originStation: "京都" },
            },
          }],
        },
        {
          role: "user",
          content: [{
            toolResult: {
              toolUseId: "tool-1",
              status: "success",
              content: [{ json: { journeys: [] } }],
            },
          }],
        },
      ],
    });
    expect(messages).toHaveLength(2);
    expect(() => validatedMessages({
      messages: [{ role: "user", content: [{ text: "a".repeat(4_001) }] }],
    })).toThrow(RequestError);
  });

  it("accepts allowlisted unique provider-independent tools", () => {
    const definition = {
      name: "search_journeys",
      description: "時刻表から経路を検索する",
      inputSchema: { type: "object", properties: {} },
    };
    expect(validatedToolDefinitions({ toolDefinitions: [definition] }))
      .toEqual([definition]);
    expect(() => validatedToolDefinitions({
      toolDefinitions: [{ ...definition, name: "delete_train" }],
    })).toThrow(RequestError);
    expect(() => validatedToolDefinitions({
      toolDefinitions: [definition, definition],
    })).toThrow(RequestError);
  });

  it("accepts every allowlisted tool without a separate count ceiling", () => {
    const definitions = [...allowedToolNames].map((name) => ({
      name,
      description: `${name}を実行する`,
      inputSchema: { type: "object", properties: {} },
    }));

    expect(definitions).toHaveLength(32);
    expect(definitions.some(({ name }) => name === "schedule_trip_recheck"))
      .toBe(true);
    expect(validatedToolDefinitions({ toolDefinitions: definitions }))
      .toHaveLength(32);
  });

  it("accepts only provider-independent model classes", () => {
    expect(validatedModelClass({})).toBeUndefined();
    expect(validatedModelClass({ modelClass: "lightweight" })).toBe("lightweight");
    expect(validatedModelClass({ modelClass: "decision" })).toBe("decision");
    expect(() => validatedModelClass({ modelClass: "amazon.nova-lite-v1:0" }))
      .toThrow(RequestError);
  });
});

function event(body: string) {
  return { requestContext: { http: { method: "POST" } }, body };
}

function expectRequestError(
  action: () => unknown,
  statusCode: number,
  message?: string,
): void {
  try {
    action();
    throw new Error("RequestErrorが必要です");
  } catch (error) {
    expect(error).toBeInstanceOf(RequestError);
    expect((error as RequestError).statusCode).toBe(statusCode);
    if (message) expect((error as Error).message).toBe(message);
  }
}
