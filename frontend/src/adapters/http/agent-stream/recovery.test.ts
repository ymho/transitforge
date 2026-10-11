import { expect, it, vi } from "vitest";
import { recoverConversationTurn } from "./recovery";
it("reads the exact turn until it is saved, preserving public artifacts without running Agent", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ version: "conversation-api-v1", state: "pending" }))
    .mockResolvedValueOnce(Response.json({ version: "conversation-api-v1", state: "completed", result: { status: "completed", response: "保存した回答" } }));
  const event = await recoverConversationTurn({ token: "token", conversationId: "conversation", turnId: "turn", signal: new AbortController().signal, isCurrent: () => true, fetcher, deadlineMs: 1_000, pollMs: 1 });
  expect(event).toEqual({ type: "final", status: "completed", response: "保存した回答" });
  expect(fetcher.mock.calls.every(([url]) => url === "/api/conversations/v1")).toBe(true);
  expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body))).toMatchObject({ operation: "turn", conversationId: "conversation", turnId: "turn" });
});
it("never displays a recovered answer after switching trip", async () => {
  let current = true;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => { current = false; return Response.json({ version: "conversation-api-v1", state: "completed", result: { status: "completed", response: "古い回答" } }); });
  await expect(recoverConversationTurn({ token: "token", conversationId: "old", turnId: "turn", signal: new AbortController().signal, isCurrent: () => current, fetcher, deadlineMs: 1_000 })).rejects.toThrow("stale_generation");
});
it("does not reinterpret a missing, failed or malformed receipt as a saved answer", async () => {
  for (const state of ["missing", "failed"]) expect(await recoverConversationTurn({ token: "token", conversationId: "c", turnId: "t", signal: new AbortController().signal, isCurrent: () => true, fetcher: async () => Response.json({ version: "conversation-api-v1", state }), deadlineMs: 1_000 })).toBeUndefined();
});
