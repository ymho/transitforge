// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { createTrip } from "@raiquora/trip/trip";
import type { PublicSemanticReceipt } from "@raiquora/agent/public-semantic-receipt";
import { configureAiGuidePanel } from "./ai-guide-panel";
import { configureConsultationScreen } from "../home/consultation-screen";
import { createServerTripWorkspaceSource } from "../../usecases/trip-plan/server-trip-workspace-source";
import type { AssistantTurnView } from "../../domain/assistant-turn-view";

const receipt: PublicSemanticReceipt = { version: "public-semantic-receipt-v1", intentRevision: 1,
  speechAct: "inform", outcome: "accepted", changes: [{ changeRef: "change", groupRef: "group", action: "replace",
    target: "destination", scope: { type: "conversation" }, frame: "actual", status: "accepted" }] };

async function setup(history = false, candidateSaved = false) {
  document.body.innerHTML = '<section><ol></ol><form><input><button type="submit"></button></form></section>';
  const trip = createTrip("11111111-1111-4111-8111-111111111111", "旅の相談", "2026-09-29T00:00:00Z");
  let stored = trip, session = "a";
  const get = vi.fn(async () => structuredClone(stored));
  const source = createServerTripWorkspaceSource(trip.id, { get }); await source.refresh();
  const response: AssistantTurnView = candidateSaved ? { text: "選んだ案を保存しました。",
    tripMutationReceipt: { version: "public-trip-mutation-receipt-v1", tripId: trip.id, tripRevision: 1 } } : { text: "行き先の紹介です。", semanticReceipt: receipt };
  let resolve!: (response: AssistantTurnView) => void;
  const handle = vi.fn(() => new Promise<AssistantTurnView>(r => { resolve = r; }));
  const panel = document.querySelector("section")!, messages = document.querySelector("ol")!, form = document.querySelector("form")!, input = document.querySelector("input")!;
  const button = () => document.createElement("button"), select = () => document.createElement("select");
  const reload = vi.fn(() => { void source.retry!(); });
  const controller = configureAiGuidePanel({ conversationSessionId: session, panel, messages, form, input,
    submit: document.querySelector("button")!, toggle: button(), close: button(), suggestions: [], settingsToggle: button(), settingsPanel: document.createElement("div"), transferPace: select(), rankingPreference: select(), storage: localStorage,
    responseContextKey: () => `${session}:${source.getCurrentTrip()?.revision}`,
    onTripConditionsSaved: reload,
    historyRepository: { list: () => history ? [{ role: "assistant", response, messageId: "old" }] : [],
      append: (_session, entry) => ({ ...entry, messageId: crypto.randomUUID() }), delete: vi.fn() },
  }, handle);
  configureConsultationScreen(panel, messages, form, input, {
    read: () => ({ sessionId: session, trip: source.getCurrentTrip() }), profile: () => undefined,
    subscribe: source.subscribe!, save: vi.fn(async () => {}), showTrip: vi.fn(), newConversation: vi.fn(),
  });
  return { panel, messages, get, source, controller, reload, response,
    save() { stored = { ...trip, revision: 1, ...(candidateSaved ? { items: [{ id: "selected", type: "activity" as const, title: "採用した予定", category: "sightseeing" as const, schedule: { type: "unscheduled" as const } }] } : {}), request: { ...trip.request, constraints: [{ id: "destination", source: "user", strength: "hard",
      scope: { type: "trip" }, requirement: { type: "destinations", places: [{ name: "出雲大社", sources: [] }], order: "flexible" } }] } }; },
    finish(value = response) { resolve(value); }, switch() { session = "b"; controller.switchSession(session); },
  };
}

it("reloads the authoritative Trip after rendering a saved response and updates the condition sheet", async () => {
  const f = await setup(); f.controller.ask("出雲大社に行きたい"); f.save(); f.finish();
  await vi.waitFor(() => expect(f.panel.querySelector(".consultation-condition-rows")?.textContent).toContain("出雲大社"));
  expect(f.reload).toHaveBeenCalledOnce(); expect(f.get).toHaveBeenCalledTimes(2);
  expect(f.messages.querySelector(".ai-guide-message-failure")).toBeNull();
  expect(f.messages.textContent).not.toContain("もう一度お試しください");
  expect(f.source.getCurrentTrip()?.revision).toBe(1);
  expect(f.panel.querySelector('[aria-label="行き先を編集"]')).not.toBeNull();
});
it.each([false, true])("does not refresh from a history receipt or a late response for another conversation (candidate=%s)", async candidateSaved => {
  const f = await setup(true, candidateSaved); f.controller.switchSession("a"); expect(f.reload).not.toHaveBeenCalled();
  f.controller.ask("出雲大社に行きたい"); f.switch(); f.finish();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(f.reload).not.toHaveBeenCalled(); expect(f.get).toHaveBeenCalledOnce();
});
it("refreshes saved itinerary items from a live adoption receipt without requiring a condition change", async () => {
  const f = await setup(false, true); f.controller.ask("案1でお願いします"); f.save(); f.finish();
  await vi.waitFor(() => expect(f.source.getCurrentTrip()?.items.map(item => item.title)).toEqual(["採用した予定"]));
  expect(f.source.getCurrentTrip()?.revision).toBe(1);
  expect(f.reload).toHaveBeenCalledOnce(); expect(f.get).toHaveBeenCalledTimes(2);
  expect(f.messages.querySelector(".ai-guide-message-failure")).toBeNull();
});
it("does not reload for rejected changes", async () => {
  const f = await setup(); f.controller.ask("条件を相談したい");
  f.finish({ ...f.response, semanticReceipt: { ...receipt, outcome: "unchanged", changes: receipt.changes.map(change => ({ ...change, status: "rejected" })) } });
  await new Promise(resolve => setTimeout(resolve, 0)); expect(f.reload).not.toHaveBeenCalled();
});
