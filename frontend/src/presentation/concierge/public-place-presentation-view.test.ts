// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { AgentTurnEvent } from "@raiquora/agent/agent-progress";
import { parsePublicPlacePresentation } from "@raiquora/agent/public-place-presentation";
import { renderPublicPlacePresentation } from "./public-place-presentation-view";
import { projectAssistantTurn } from "../../usecases/concierge/assistant-turn-projection";
import { resolveAssistantMessage } from "./ai-guide-panel";
import { consumeAgentStream } from "../../adapters/http/agent-stream/consumer";
import { HttpServerConversationClient } from "../../adapters/http/server-conversation-client";

function presentation() {
  return parsePublicPlacePresentation({ version: "public-place-presentation-v1", cards: [{ evidenceId: "evidence:garden",
    placeRef: "place:fixture:garden", title: "青葉庭園", description: "池の周囲を歩けます。\n資料で紹介されている庭園です。",
    sourceUrl: "https://example.org/garden" }] });
}
function stream(event: unknown): Response {
  return new Response(`event: agent\ndata: ${JSON.stringify({ v: 1, runId: "cards-test", seq: 1, event })}\n\nevent: done\ndata: ${JSON.stringify({ v: 1, runId: "cards-test", seq: 2 })}\n\n`,
    { headers: { "content-type": "text/event-stream" } });
}
async function consume(event: unknown) {
  const events: AgentTurnEvent[] = [];
  await consumeAgentStream({ token: "test-only", request: { userRequest: "庭園を見たい" },
    signal: new AbortController().signal, isCurrent: () => true, measurement: { requestStart: 0, maxSilenceMs: 0 },
    fetcher: vi.fn(async () => stream(event)), onEvent: (value) => events.push(value) });
  return events;
}
function historyClient(message: unknown) {
  return new HttpServerConversationClient("/api/conversations/v1", vi.fn(async () => new Response(JSON.stringify({
    version: "conversation-api-v1", items: [message],
  }), { headers: { "content-type": "application/json" } })));
}

describe("public place presentation view", () => {
  it("shows compact attributed candidate cards without a photo placeholder or save action", () => {
    const root = renderPublicPlacePresentation(presentation());
    expect(root.querySelectorAll(".public-place-card")).toHaveLength(1);
    expect(root.querySelector("h3")?.textContent).toBe("青葉庭園");
    expect(root.querySelector("blockquote")?.textContent).toContain("池の周囲を歩けます。");
    const source = root.querySelector("a")!;
    expect(source.textContent).toBe("出典 ↗");
    expect(source.href).toBe("https://example.org/garden");
    expect(source.rel).toBe("noopener noreferrer");
    expect(source.getAttribute("aria-label")).toBe("青葉庭園の出典を開く");
    expect(root.querySelectorAll("img, iframe, button, form")).toHaveLength(0);
    expect(root.textContent).not.toMatch(/保存|予約|evidence:garden|place:fixture/u);
  });
  it("treats title and excerpt markup as text, never active HTML", () => {
    const value = presentation();
    value.cards[0]!.title = "<img src=x onerror=alert(1)>";
    value.cards[0]!.description = "<script>alert(1)</script>";
    const root = renderPublicPlacePresentation(value);
    expect(root.querySelectorAll("script, img")).toHaveLength(0);
    expect(root.querySelector("h3")?.textContent).toBe(value.cards[0]!.title);
    expect(root.querySelector("blockquote")?.textContent).toBe(value.cards[0]!.description);
  });
  it("renders the same candidate snapshot from final SSE and restored history without duplicating the card", async () => {
    const cards = presentation();
    const event = { type: "final" as const, status: "completed" as const, response: "散策先として検討できます。", publicPlacePresentation: cards };
    const events = await consume(event);
    const final = events[0];
    if (final?.type !== "final") throw new Error("Expected final SSE");
    const history = await historyClient({ role: "assistant", text: event.response, sequence: 2,
      createdAt: "2026-09-26T10:00:00Z", publicPlacePresentation: cards }).history("00000000-0000-4000-8000-000000000001");
    const saved = history.items[0]!;
    const live = projectAssistantTurn(final), restored = projectAssistantTurn({ response: saved.text, ...saved });
    expect(restored).toEqual(live);
    const item = document.createElement("li"); item.scrollIntoView = vi.fn();
    resolveAssistantMessage(item, live, undefined, undefined, undefined, undefined, false);
    const initial = item.innerHTML;
    resolveAssistantMessage(item, restored, undefined, undefined, undefined, undefined, false);
    expect(item.innerHTML).toBe(initial);
    expect(item.querySelectorAll(".public-place-card")).toHaveLength(1);
    expect(item.querySelector(".ai-guide-message-copy")?.textContent).toBe(event.response);
    expect(item.querySelector(".ai-guide-message-copy")?.textContent).not.toContain(cards.cards[0]!.description);
  });
  it.each(["unsafe_url", "extra_field"])("rejects %s card data at both SSE and history boundaries", async (failure) => {
    const cards = presentation();
    const value = { ...cards, cards: [{ ...cards.cards[0], ...(failure === "unsafe_url"
      ? { sourceUrl: "javascript:alert(1)" } : { ownerSubject: "private" }) }] };
    await expect(consume({ type: "final", status: "completed", response: "候補", publicPlacePresentation: value })).rejects.toBeDefined();
    await expect(historyClient({ role: "assistant", text: "候補", sequence: 2, createdAt: "2026-09-26T10:00:00Z",
      publicPlacePresentation: value }).history("00000000-0000-4000-8000-000000000001")).rejects.toBeDefined();
  });
  it("rejects a candidate artifact attached to an untrusted user history message", async () => {
    await expect(historyClient({ role: "user", text: "候補", sequence: 1, createdAt: "2026-09-26T10:00:00Z",
      publicPlacePresentation: presentation() }).history("00000000-0000-4000-8000-000000000001")).rejects.toBeDefined();
  });
});
