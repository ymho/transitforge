import { describe, expect, it, vi } from "vitest";
import { HttpServerConversationClient, ConversationApiError, reportConversationReadFailure } from "./server-conversation-client";
import { ApiAuthenticationError } from "../../usecases/auth/api-authentication-error";
const id = "11111111-1111-4111-8111-111111111111";
const metadata = { title: "相談", scope: "trip" as const, tripId: "22222222-2222-4222-8222-222222222222", summary: "", resolvedTopics: [], pendingTopics: [] };
const conversation = { ...metadata, conversationId: id, createdAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T00:00:00.000Z", revision: 0, messageCount: 0 };
describe("Conversation HTTP client", () => {
  it("preserves session-change rejection as authentication failure", async () => {
    const failure = new ApiAuthenticationError("session-changed");
    const request = vi.fn<typeof fetch>().mockRejectedValue(failure);
    await expect(new HttpServerConversationClient("/api/conversations/v1", request).get(id)).rejects.toBe(failure);
  });
  it("distinguishes history HTTP rejection from transport failure without retaining response content", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("private response", { status: 501 }))
      .mockRejectedValueOnce(new Error("private request"));
    const client = new HttpServerConversationClient("/api/conversations/v1", request);
    await expect(client.history(id)).rejects.toMatchObject({ operation: "history", stage: "http", status: 501 });
    await expect(client.get(id)).rejects.toMatchObject({ operation: "get", stage: "transport" });
  });
  it("reports bounded read stages without logging raw errors or conversation data", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      reportConversationReadFailure("history", new ConversationApiError("history", "http", 501));
      expect(JSON.parse(warning.mock.calls.at(-1)![1])).toEqual({ stage: "history", operation: "history", boundary: "http", status: 501 });
      reportConversationReadFailure("render", new Error("private text and token"));
      expect(JSON.parse(warning.mock.calls.at(-1)![1])).toEqual({ stage: "render", reason: "unknown" });
      reportConversationReadFailure("history", new ConversationApiError("private operation", "transport"));
      expect(JSON.stringify(warning.mock.calls)).not.toContain("private");
    } finally { warning.mockRestore(); }
  });
  it("uses the versioned personal endpoint without owner input", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ version: "conversation-api-v1", conversation })));
    const client = new HttpServerConversationClient("/api/conversations/v1", request);
    expect(await client.create(metadata)).toEqual(conversation);
    expect(JSON.parse(request.mock.calls[0]![1]!.body as string)).toEqual({ version: "conversation-api-v1", operation: "create", metadata });
  });
  it("does not turn a malformed response into a conversation", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ version: "conversation-api-v1", items: [{ conversationId: id }] })));
    await expect(new HttpServerConversationClient("/api/conversations/v1", request).list()).rejects.toThrow("Invalid Conversation API response");
  });
  it("accepts strict public delivery/semantic history and rejects extra private fields", async () => {
    const receipt = { version: "public-semantic-receipt-v1", intentRevision: 1, speechAct: "inform", outcome: "accepted", changes: [] };
    const item = { role: "assistant", text: "限定回答", sequence: 1, createdAt: "2026-09-18T00:00:00.000Z",
      delivery: { status: "degraded", basis: "verified_projection" }, semanticReceipt: receipt };
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ version: "conversation-api-v1", items: [item] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: "conversation-api-v1", items: [{ ...item, trace: "private" }] })));
    const client = new HttpServerConversationClient("/api/conversations/v1", request);
    expect((await client.history(id)).items).toEqual([item]);
    await expect(client.history(id)).rejects.toThrow("Invalid Conversation API response");
  });
});
