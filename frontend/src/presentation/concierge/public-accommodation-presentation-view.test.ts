// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import type { AgentTurnEvent } from "@raiquora/agent/agent-progress";
import { parsePublicAccommodationPresentation } from "@raiquora/agent/public-accommodation-presentation";
import { consumeAgentStream } from "../../adapters/http/agent-stream/consumer";
import { HttpServerConversationClient } from "../../adapters/http/server-conversation-client";
import { projectAssistantTurn } from "../../usecases/concierge/assistant-turn-projection";
import { configureAiGuidePanel, resolveAssistantMessage } from "./ai-guide-panel";
import { parsePublicPlanPresentation } from "@raiquora/agent/public-plan-presentation";
import { renderPublicAccommodationPresentation, canCombineAccommodationPlan } from "./public-accommodation-presentation-view";

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
  resolveAssistantMessage(item, live, { animate: false });
  const initial = item.innerHTML;
  resolveAssistantMessage(item, restored, { animate: false });
  expect(item.innerHTML).toBe(initial);
  expect(item.querySelectorAll(".public-place-card")).toHaveLength(3);
  expect(item.querySelectorAll("script, img")).toHaveLength(0);
  expect(item.querySelectorAll(".accommodation-navigation button")).toHaveLength(2);
  expect(item.querySelectorAll(".public-accommodation-presentation form")).toHaveLength(0);
  expect(item.querySelector("h3")?.textContent).toBe(cards.cards[0]!.name);
  expect(item.textContent).toContain("指定日の空室・料金は未確認です。");
  expect(item.textContent).toContain("日本時間");
  expect(item.querySelector(".ai-guide-message-copy")?.textContent).toBe("宿3件を表示しました。パネルで比較できます。");
  expect(item.querySelector<HTMLDetailsElement>(".candidate-reply-details")?.open).toBe(false);
  expect(item.querySelector("a")?.rel).toBe("noopener noreferrer");
});

function hotelFixture() {
  const hotels = parsePublicAccommodationPresentation({ version: "public-accommodation-presentation-v1", cards: [1, 2].map(id => ({
    evidenceId: `hotel-${id}`, name: "同名の宿", summary: `2026-10-05〜2026-10-06\n参考最安値: JPY ${id * 10000}\n空室は未確認`, retrievedAt: "2026-10-04T00:00:00Z", sourceUrl: `https://example.org/hotel/${id}`,
  })) });
  const candidates = [2, 1].map(id => ({ variantId: `variant-${id}`, label: "同名の宿", dayOrder: [`day-${id}-1`, `day-${id}-2`],
    days: [1, 2].map(day => ({ dayRef: `day-${id}-${day}`, label: `2026-10-0${day + 4}`, status: "planned" as const,
      entries: [{ entryRef: `entry-${id}-${day}`, itemRef: `item-${id}`, role: day === 1 ? "start" as const : "end" as const }] })),
    items: [{ itemRef: `item-${id}`, sourceRef: `hotel-${id}`, title: "同名の宿", kind: "stay" as const, timing: "day" as const, evidenceRefs: [], photoRefs: [] }],
    unknowns: ["空室"], comparisonAssessmentRefs: [], scenarioRefs: [], cost: { status: "unknown" as const }, workload: { status: "unknown" as const } }));
  const plan = parsePublicPlanPresentation({ version: "public-plan-presentation-v1", presentationId: "hotels-plan", target: { tripId: "11111111-1111-4111-8111-111111111111", baseTripRevision: 5 },
    candidateSetRef: { kind: "candidate-set-ref", candidateSetId: "hotel-set", revision: 2, baseTripRevision: 5 }, candidates, candidateOrder: candidates.map(c => c.variantId),
    evidenceRefs: [], photoRefs: [], statements: [], comparisonAssessmentRefs: [], scenarioRefs: [],
    coverage: { status: "complete", coveredDayRefs: candidates.flatMap(c => c.dayOrder), omittedDayRefs: [], omittedScopes: [] },
    researchOutcome: { status: "complete", requestedMode: "standard", effectiveMode: "standard", budget: { modelCalls: 0, toolCalls: 0, wallClockMs: 0 }, coveredScopes: [], remainingScopes: [] } });
  return { hotels, plan };
}

it("merges hotel facts and adoption once, keeping source-ID binding when names and ordering coincide", () => {
  const { hotels, plan } = hotelFixture();
  const item = document.createElement("li"); item.scrollIntoView = vi.fn();
  const adoption = vi.fn(), detail = vi.fn(); item.addEventListener("raiquora:preview-plan-adoption", adoption); item.addEventListener("raiquora:detailed-research", detail);
  const longText = "宿の名前・価格・評価の長い説明。".repeat(20);
  resolveAssistantMessage(item, { text: longText, publicAccommodationPresentation: hotels, publicPlanPresentation: plan }, { animate: false });
  expect(item.querySelector(".ai-guide-message-copy")?.textContent).toBe("宿2件を表示しました。パネルで比較できます。");
  const explanation = item.querySelector<HTMLDetailsElement>(".candidate-reply-details")!;
  expect(explanation.open).toBe(false); expect(explanation.textContent).toContain(longText);
  explanation.open = true; expect(explanation.textContent).toContain(longText);
  expect(item.querySelectorAll(".public-accommodation-presentation")).toHaveLength(1);
  expect(item.querySelector(".public-plan-presentation")).toBeNull();
  expect(item.querySelector(".public-plan-days")).toBeNull();
  const cards = [...item.querySelectorAll<HTMLElement>(".public-place-card")];
  expect(cards[0]!.hidden).toBe(false); expect(cards[1]!.hidden).toBe(true);
  cards[0]!.querySelector<HTMLButtonElement>(".public-plan-adopt")!.click();
  expect(adoption.mock.calls[0]![0].detail).toMatchObject({ variantId: "variant-1", candidateSetId: "hotel-set", baseTripRevision: 5 });
  const next = item.querySelector<HTMLButtonElement>('[aria-label="次の宿泊候補"]')!;
  next.click(); expect(cards[1]!.hidden).toBe(false); expect(next.disabled).toBe(true);
  cards[1]!.querySelector<HTMLButtonElement>(".public-plan-adopt")!.click();
  expect(adoption.mock.calls[1]![0].detail.variantId).toBe("variant-2");
  expect(item.querySelector(".public-plan-detail")).toBeNull(); expect(detail).not.toHaveBeenCalled();
  expect(cards[0]!.querySelector(".accommodation-actions")?.firstElementChild?.classList.contains("public-plan-adopt")).toBe(true);
  item.querySelector<HTMLButtonElement>('[aria-label="前の宿泊候補"]')!.click();
  expect(cards[0]!.hidden).toBe(false);
  expect(item.textContent).toContain("JPY 10000"); expect(item.textContent).toContain("空室は未確認");
});

it("keeps unmatched, composite and display-only plans separate without guessing from hotel names", () => {
  const { hotels, plan } = hotelFixture();
  const wrong = { ...plan, candidates: plan.candidates.map((candidate, index) => index ? candidate :
    { ...candidate, items: candidate.items.map(item => ({ ...item, sourceRef: "foreign-observation" })) }) };
  expect(canCombineAccommodationPlan(hotels, wrong)).toBe(false);
  const composite = { ...plan, candidates: plan.candidates.map((candidate, index) => index ? candidate :
    { ...candidate, items: [...candidate.items, { ...candidate.items[0]!, itemRef: "extra", kind: "activity" as const }] }) };
  expect(canCombineAccommodationPlan(hotels, composite)).toBe(false);
  expect(canCombineAccommodationPlan(hotels, { ...plan, target: undefined })).toBe(false);
  const item = document.createElement("li"); item.scrollIntoView = vi.fn();
  resolveAssistantMessage(item, { text: "候補です。", publicAccommodationPresentation: hotels, publicPlanPresentation: wrong }, { animate: false });
  expect(item.querySelectorAll(".public-plan-presentation")).toHaveLength(1);
  expect(item.querySelectorAll(".public-accommodation-presentation .public-plan-adopt")).toHaveLength(0);
});

it("shows provider photos, fractional review stars, aligned facts and compact source credit", () => {
  const { hotels, plan } = hotelFixture();
  Object.assign(hotels.cards[0]!, { imageUrl: "https://example.org/photo.jpg", reviewAverage: 4.35, provider: "rakuten-travel" });
  const restored = parsePublicAccommodationPresentation(JSON.parse(JSON.stringify(hotels)));
  const section = renderPublicAccommodationPresentation(restored, plan);
  const photo = section.querySelector<HTMLImageElement>(".accommodation-photo")!;
  expect(photo.src).toBe("https://example.org/photo.jpg");
  expect(section.querySelector(".accommodation-rating")?.getAttribute("aria-label")).toBe("5点満点中4.35");
  expect(section.querySelector<HTMLElement>(".accommodation-stars > span")?.style.width).toBe("87%");
  expect(section.querySelector(".accommodation-facts dt")?.textContent).toBe("宿泊日");
  expect(section.querySelector(".accommodation-notice")?.textContent).toContain("空室は未確認");
  expect(section.querySelector(".accommodation-footer img")?.getAttribute("alt")).toBe("楽天トラベル");
  expect(section.querySelector(".accommodation-source-link")).not.toBeNull();
  section.querySelector<HTMLButtonElement>('[aria-label="次の宿泊候補"]')!.click();
  expect(section.querySelectorAll<HTMLElement>(".public-place-card")[1]!.hidden).toBe(false);
  photo.dispatchEvent(new Event("error")); expect(section.querySelector(".accommodation-photo")).toBeNull();
});

it("browses all ten display-only hotels with arrows and keeps endpoints bounded", () => {
  const { hotels } = hotelFixture();
  const ten = { ...hotels, cards: Array.from({ length: 10 }, (_, i) => ({ ...hotels.cards[0]!, evidenceId: `hotel-${i}`, name: `宿${i}` })) };
  const section = renderPublicAccommodationPresentation(ten);
  const next = section.querySelector<HTMLButtonElement>('[aria-label="次の宿泊候補"]')!;
  const previous = section.querySelector<HTMLButtonElement>('[aria-label="前の宿泊候補"]')!;
  expect(previous.disabled).toBe(true);
  for (let i = 0; i < 9; i++) next.click();
  expect(section.querySelector('[aria-live="polite"]')?.textContent).toBe("10 / 10");
  expect(section.querySelectorAll<HTMLElement>(".public-place-card")[9]!.hidden).toBe(false);
  expect(next.disabled).toBe(true);
  previous.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
  expect(section.querySelector('[aria-live="polite"]')?.textContent).toBe("9 / 10");
  expect(section.querySelector('[role="tab"]')).toBeNull();
});

it("retains the consultation screen when a new accommodation plan arrives", async () => {
  const { hotels, plan } = hotelFixture();
  const panel = document.createElement("section"), messages = document.createElement("ol"), form = document.createElement("form");
  const input = document.createElement("input"), submit = document.createElement("button"); form.append(input, submit); panel.append(messages, form);
  const button = () => document.createElement("button"), select = () => document.createElement("select");
  const onPlanPresentation = vi.fn();
  const controller = configureAiGuidePanel({
    conversationSessionId: "hotels-navigation", panel, messages, form, input, submit,
    toggle: button(), close: button(), suggestions: [], settingsToggle: button(), settingsPanel: document.createElement("div"),
    transferPace: select(), rankingPreference: select(), storage: localStorage, onPlanPresentation,
    historyRepository: { list: () => [], append: (_session, entry) => ({ ...entry, messageId: "hotels-message" }), delete: vi.fn() },
  }, async () => ({ text: "宿泊候補です。", publicAccommodationPresentation: hotels, publicPlanPresentation: plan }));
  controller.ask("宿を探して");
  await vi.waitFor(() => expect(onPlanPresentation).toHaveBeenCalledWith(plan, false));
  expect(messages.querySelector(".accommodation-navigation")).not.toBeNull();
});
