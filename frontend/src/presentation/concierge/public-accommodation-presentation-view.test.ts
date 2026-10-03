// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import type { AgentTurnEvent } from "@raiquora/agent/agent-progress";
import { parsePublicAccommodationPresentation } from "@raiquora/agent/public-accommodation-presentation";
import { consumeAgentStream } from "../../adapters/http/agent-stream/consumer";
import { HttpServerConversationClient } from "../../adapters/http/server-conversation-client";
import { projectAssistantTurn } from "../../usecases/concierge/assistant-turn-projection";
import { resolveAssistantMessage } from "./ai-guide-panel";

it("keeps all hotel comparisons through SSE, the viewer projection and restored history", async () => {
  const cards = parsePublicAccommodationPresentation({ version: "public-accommodation-presentation-v1", cards: [1, 2, 3].map(id => ({
    evidenceId: `hotel-${id}`, name: id === 1 ? "<img src=x onerror=alert(1)>" : `比較用の宿${id}`,
    summary: "2026-10-04〜2026-10-05\n参考最低料金: 5,100円\n指定日の空室・料金は未確認です。",
    retrievedAt: "2026-10-03T00:00:00Z", sourceUrl: `https://example.org/hotels/${id}`,
  })) });
  const final = { type: "final" as const, status: "completed" as const, response: "宿泊候補を比較できます。", publicAccommodationPresentation: cards };
  const events: AgentTurnEvent[] = [];
  const body = `event: agent\ndata: ${JSON.stringify({ v: 1, runId: "hotels-test", seq: 1, event: final })}\n\nevent: done\ndata: ${JSON.stringify({ v: 1, runId: "hotels-test", seq: 2 })}\n\n`;
  await consumeAgentStream({ token: "test-only", request: { userRequest: "宿を比較したい" }, signal: new AbortController().signal,
    isCurrent: () => true, measurement: { requestStart: 0, maxSilenceMs: 0 }, onEvent: event => events.push(event),
    fetcher: vi.fn(async () => new Response(body, { headers: { "content-type": "text/event-stream" } })) });
  const event = events[0]; if (event?.type !== "final") throw Error("Final SSE missing");
  const client = new HttpServerConversationClient("/api/conversations/v1", vi.fn(async () => new Response(JSON.stringify({
    version: "conversation-api-v1", items: [{ role: "assistant", text: final.response, sequence: 2,
      createdAt: "2026-10-03T00:00:00Z", publicAccommodationPresentation: cards }],
  }), { headers: { "content-type": "application/json" } })));
  const saved = (await client.history("00000000-0000-4000-8000-000000000001")).items[0]!;
  const live = projectAssistantTurn(event), restored = projectAssistantTurn({ ...saved, response: saved.text });
  expect(restored).toEqual(live);
  const item = document.createElement("li"); item.scrollIntoView = vi.fn();
  resolveAssistantMessage(item, live, undefined, undefined, undefined, undefined, false);
  const initial = item.innerHTML;
  resolveAssistantMessage(item, restored, undefined, undefined, undefined, undefined, false);
  expect(item.innerHTML).toBe(initial);
  expect(item.querySelectorAll(".public-place-card")).toHaveLength(3);
  expect(item.querySelectorAll("script, img")).toHaveLength(0);
  expect(item.querySelectorAll(".public-accommodation-presentation button, .public-accommodation-presentation form")).toHaveLength(0);
  expect(item.querySelector("h3")?.textContent).toBe(cards.cards[0]!.name);
  expect(item.textContent).toContain("指定日の空室・料金は未確認です。");
  expect(item.textContent).toContain("日本時間");
  expect(item.querySelector("a")?.rel).toBe("noopener noreferrer");
});
