// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { createTrip } from "@raiquora/trip/trip";
import { createTripWorkspaceController } from "../../usecases/trip-plan/trip-workspace-controller";
import { configureTripWorkspace } from "../trip-plan/trip-workspace";
import { configureAiFirstShell } from "./ai-first-shell";

afterEach(() => document.body.replaceChildren());
it("uses the same consultation surface from Trip, returns to Trip, and makes the menu a fresh entry", async () => {
  document.body.innerHTML = '<main id="app"><section id="chat"><ol></ol><input></section></main>';
  window.history.replaceState(null, "", "#chat");
  const app = document.querySelector<HTMLElement>("main")!, chat = document.querySelector<HTMLElement>("#chat")!;
  const trip = createTrip("45300000-0000-4000-8000-000000000001", "出雲旅行", "2026-09-27T00:00:00Z", [
    { id: "shrine", title: "出雲大社", type: "activity", category: "sightseeing", schedule: { type: "unscheduled" } },
  ]);
  const controller = createTripWorkspaceController("trip-conversation"), ask = vi.fn();
  controller.attach("trip-conversation", { getCurrentTrip: () => trip });
  let workspace: ReturnType<typeof configureTripWorkspace>;
  const shell = configureAiFirstShell(document, app, {
    read: () => ({ state: "available", trips: [trip] }), authState: () => ({ status: "signed-in", displayName: "テスト" }),
    subscribe: () => () => {}, login: vi.fn(), logout: vi.fn(), retry: vi.fn(async () => {}),
    newConsultation: vi.fn(async () => {}), resetConsultation: vi.fn(), openChat: vi.fn(), openMap: vi.fn(),
    openTrip: () => workspace.show("trip"), journeySettings: () => ({ transferPace: "standard", rankingPreference: "balanced" }),
    setJourneySettings: vi.fn(), now: () => new Date("2026-09-27T00:00:00Z"),
  });
  workspace = configureTripWorkspace({ app, chat, messages: chat.querySelector("ol")!, input: chat.querySelector("input")!, controller,
    ask, showContext: vi.fn(), returnToConversation: vi.fn(), showMap: vi.fn(), nextItemId: () => "new-item",
    onViewChange: view => view === "trip" ? shell.showTrip(trip.id) : shell.showConversation(trip.id),
  });
  shell.navigate("trips"); document.querySelector<HTMLButtonElement>("[data-trip]")!.click();
  expect(app.dataset.primaryView).toBe("trip-loading");
  await vi.waitFor(() => expect(app.dataset.primaryView).toBe("trip"));
  expect(document.querySelector("[data-trip-chat]")).toBeNull();
  expect(document.querySelector("[data-trip-consultation]")).not.toBeNull();
  const item = document.querySelector<HTMLElement>('[data-item-id="shrine"]')!;
  expect(item.querySelector(".trip-item-consult")).toBeNull();
  document.querySelector<HTMLButtonElement>("[data-trip-consultation]")!.click();
  expect(app.dataset.primaryView).toBe("trip"); expect(ask).not.toHaveBeenCalled();
  document.querySelector<HTMLButtonElement>(".trip-consultation-options button")!.click();
  expect(app.dataset.primaryView).toBe("chat"); expect(app.dataset.consultationMode).toBe("conversation");
  expect(window.history.state.tripId).toBe(trip.id); expect(ask).toHaveBeenCalledWith("相談対象：旅程「出雲旅行」の1番目の予定「出雲大社」。\nこの予定の名称を踏まえて、具体的な場所と訪問時刻を確認したい。名前が決まっていても、所在地・営業時間は未確認です");
  expect(controller.uiFocus()).toEqual({ itemId: "shrine" });
  expect(controller.sessionId()).toBe("trip-conversation");
  workspace.show("trip"); expect(app.dataset.primaryView).toBe("trip");
  shell.navigate("chat"); expect(app.dataset.consultationMode).toBe("landing"); expect(window.history.state.tripId).toBeUndefined();
  shell.dispose();
});

it("switches a retained Trip through tabs and browser history without restarting history, losing drafts or resending", async () => {
  document.body.innerHTML = '<main id="app"><section id="chat"><ol><li>処理中の会話</li></ol><input></section></main>';
  window.history.replaceState(null, "", "#chat");
  const app = document.querySelector<HTMLElement>("main")!, chat = document.querySelector<HTMLElement>("#chat")!;
  const trip = createTrip("45300000-0000-4000-8000-000000000001", "神戸の旅", "2026-10-13T00:00:00Z", []);
  const controller = createTripWorkspaceController("retained"), ask = vi.fn(), restore = vi.fn();
  controller.attach("retained", { getCurrentTrip: () => trip });
  let workspace: ReturnType<typeof configureTripWorkspace>;
  const shell = configureAiFirstShell(document, app, {
    read: () => ({ state: "available", trips: [trip] }), authState: () => ({ status: "signed-in", displayName: "テスト" }),
    subscribe: () => () => {}, login: vi.fn(), logout: vi.fn(), retry: vi.fn(async () => {}),
    newConsultation: vi.fn(async () => {}), resetConsultation: vi.fn(), openChat: vi.fn(), openMap: vi.fn(),
    openTrip: restore, consultTrip: restore, activeTrip: () => controller.current()?.id, switchTripView: view => workspace.show(view),
    journeySettings: () => ({ transferPace: "standard", rankingPreference: "balanced" }), setJourneySettings: vi.fn(), now: () => new Date(),
  });
  const input = chat.querySelector("input")!, messages = chat.querySelector("ol")!;
  workspace = configureTripWorkspace({ app, chat, messages, input, controller,
    ask, showContext: vi.fn(), returnToConversation: vi.fn(), showMap: vi.fn(), nextItemId: () => "new-item",
    onViewChange: view => view === "trip" ? shell.showTrip(trip.id) : shell.showConversation(trip.id),
  });
  workspace.show("chat"); input.value = "まだ送っていない相談"; input.focus(); messages.scrollTop = 170;
  const retainedMessages = messages.firstElementChild;
  const itineraryTab = workspace.nav.querySelector<HTMLButtonElement>('[aria-controls="trip-detail-itinerary"]')!;
  const chatTab = workspace.nav.querySelector<HTMLButtonElement>('[aria-controls="chat"]')!;
  itineraryTab.click(); workspace.panel.scrollTop = 210;
  expect(chat.hidden).toBe(true); expect(itineraryTab.getAttribute("aria-selected")).toBe("true");
  // The existing stream's next chunk may arrive while its view is hidden.
  messages.firstElementChild!.textContent += "…追加の応答";
  chatTab.click();
  expect(messages.firstElementChild).toBe(retainedMessages); expect(messages.textContent).toContain("追加の応答");
  expect(input.value).toBe("まだ送っていない相談"); expect(messages.scrollTop).toBe(170);
  expect(document.activeElement).toBe(input); expect(controller.sessionId()).toBe("retained");
  expect(app.dataset.primaryView).toBe("chat"); expect(document.querySelector('[data-primary="trips"]')!.getAttribute("aria-current")).toBe("page");
  expect(workspace.panel.contains(chat)).toBe(true); expect(workspace.nav.previousElementSibling?.className).toBe("trip-workspace-heading");
  // Restore history entries explicitly, as a popstate does, rather than invoking feature callbacks.
  window.history.replaceState({ tripId: trip.id }, "", "#trip"); window.dispatchEvent(new PopStateEvent("popstate"));
  expect(workspace.panel.scrollTop).toBe(210);
  window.history.replaceState({ consultation: "trip", tripId: trip.id }, "", "#chat"); window.dispatchEvent(new PopStateEvent("popstate"));
  expect(input.value).toBe("まだ送っていない相談"); expect(messages.scrollTop).toBe(170);
  expect(restore).not.toHaveBeenCalled(); expect(ask).not.toHaveBeenCalled();
  chatTab.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(itineraryTab); expect(itineraryTab.getAttribute("aria-selected")).toBe("true");
  shell.dispose(); workspace.destroy();
});
