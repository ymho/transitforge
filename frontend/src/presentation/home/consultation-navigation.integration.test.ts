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
    setJourneySettings: vi.fn(), openNotifications: vi.fn(), now: () => new Date("2026-09-27T00:00:00Z"),
  });
  workspace = configureTripWorkspace({ app, chat, messages: chat.querySelector("ol")!, input: chat.querySelector("input")!, controller,
    ask, showContext: vi.fn(), returnToConversation: vi.fn(), showMap: vi.fn(), nextItemId: () => "new-item",
    onViewChange: view => view === "trip" ? shell.showTrip(trip.id) : shell.showConversation(trip.id),
  });
  shell.navigate("trips"); document.querySelector<HTMLButtonElement>("[data-trip]")!.click();
  expect(app.dataset.primaryView).toBe("trip-loading");
  await vi.waitFor(() => expect(app.dataset.primaryView).toBe("trip"));
  expect(document.querySelector("[data-trip-chat]")).toBeNull();
  expect(document.querySelector("[data-trip-consultation]")).toBeNull();
  const item = document.querySelector<HTMLElement>('[data-item-id="shrine"]')!;
  [...item.querySelectorAll("button")].find(button => button.textContent === "相談する")!.click();
  expect(app.dataset.primaryView).toBe("chat"); expect(app.dataset.consultationMode).toBe("conversation");
  expect(window.history.state.tripId).toBe(trip.id); expect(ask).toHaveBeenCalledWith("この予定を相談したい");
  expect(controller.uiFocus()).toEqual({ itemId: "shrine" });
  expect(controller.sessionId()).toBe("trip-conversation");
  workspace.show("trip"); expect(app.dataset.primaryView).toBe("trip");
  shell.navigate("chat"); expect(app.dataset.consultationMode).toBe("landing"); expect(window.history.state.tripId).toBeUndefined();
  shell.dispose();
});
