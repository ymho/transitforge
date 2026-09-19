import { describe, expect, it, vi } from "vitest";
import { HttpServerConversationClient } from "./server-conversation-client";
const id = "11111111-1111-4111-8111-111111111111";
const metadata = { title: "相談", scope: "general" as const, summary: "", resolvedTopics: [], pendingTopics: [] };
const conversation = { ...metadata, conversationId: id, createdAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T00:00:00.000Z", revision: 0, messageCount: 0 };
describe("Conversation HTTP client", () => {
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
});
