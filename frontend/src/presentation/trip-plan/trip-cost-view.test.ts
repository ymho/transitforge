// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { createTrip, applyTripProposal, type Trip } from "@raiquora/trip/trip";
import { costForecast, costTripId } from "../../../../modules/trip/domain/trip-costs.fixture";
import { createTripWorkspaceController } from "../../usecases/trip-plan/trip-workspace-controller";
import { createServerTripWorkspaceSource } from "../../usecases/trip-plan/server-trip-workspace-source";
import { configureTripWorkspace } from "./trip-workspace";
const button = (root: ParentNode, text: string) => [...root.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === text)!;
afterEach(() => document.body.replaceChildren());
async function setup() {
  const original = createTrip(costTripId, "旅行", "2026-09-01T00:00:00Z");
  let server: Trip = applyTripProposal(original, { tripId: costTripId, baseRevision: 0, summary: "概算", patches: [{ type: "cost_forecast", forecast: costForecast() }] });
  const mutate = vi.fn(async (input) => { server = { ...applyTripProposal(server, input.proposal), revision: server.revision + 1 }; return server; });
  const source = createServerTripWorkspaceSource(costTripId, { get: async () => server }, { mutate, newMutationId: () => crypto.randomUUID(), validateConfirmation: async () => {} });
  const controller = createTripWorkspaceController("a"); controller.attach("a", source); await source.refresh();
  const app = document.createElement("main"), chat = document.createElement("section"), messages = document.createElement("ol"), input = document.createElement("input");
  document.body.append(app); app.append(chat); chat.append(messages, input);
  const ask = vi.fn(), ui = configureTripWorkspace({ app, chat, messages, input, controller, ask, showContext: vi.fn(), returnToConversation: vi.fn(), showMap: vi.fn(), nextItemId: () => "item" });
  return { ui, controller, source, mutate, ask, server: () => server, replace: (value: Trip) => { server = value; } };
}
it("edits one category, reviews before saving, rereads, and resets without altering other predictions", async () => {
  const f = await setup(), panel = f.ui.panel;
  expect(panel.querySelectorAll(".trip-cost-item")).toHaveLength(4); expect(panel.querySelector(".trip-cost-total")?.textContent).toContain("40,000");
  button(panel, "食事の金額を編集").click();
  const form = panel.querySelector<HTMLFormElement>(".trip-cost-editor")!;
  form.querySelector("input")!.value = "-100"; form.dispatchEvent(new Event("submit", { cancelable: true }));
  expect(f.controller.proposal()).toBeUndefined(); expect(f.mutate).not.toHaveBeenCalled();
  form.querySelector("input")!.value = "0"; form.dispatchEvent(new Event("submit", { cancelable: true }));
  expect(f.server().costs?.overrides.food).toBeUndefined();
  button(panel, "確認して旅程を保存").click();
  await vi.waitFor(() => expect(panel.querySelector(".trip-cost-total")?.textContent).toContain("30,000"));
  expect(f.server().costs?.overrides.food?.amountMinor).toBe(0);
  await f.source.refresh(); expect(panel.textContent).toContain("ユーザー編集");
  expect(f.server().costs?.forecast.items).toEqual(costForecast().items);
  button(panel, "食事をAI予測へ戻す").click(); button(panel, "確認して旅程を保存").click();
  await vi.waitFor(() => expect(panel.querySelector(".trip-cost-total")?.textContent).toContain("40,000"));
  expect(f.server().costs?.overrides.food).toBeUndefined(); f.ui.destroy();
});
it("retains interrupted input but refuses to save against an updated Trip or a different conversation", async () => {
  const f = await setup(), panel = f.ui.panel;
  button(panel, "交通の金額を編集").click();
  const form = panel.querySelector<HTMLFormElement>(".trip-cost-editor")!; form.querySelector("input")!.value = "12345";
  f.replace({ ...f.server(), revision: 1 }); await f.source.refresh();
  expect(panel.contains(form)).toBe(true); expect(form.querySelector("input")!.value).toBe("12345");
  form.dispatchEvent(new Event("submit", { cancelable: true })); expect(f.controller.proposal()).toBeUndefined();
  f.controller.activateSession("b"); expect(panel.contains(form)).toBe(false); form.dispatchEvent(new Event("submit", { cancelable: true })); expect(f.mutate).not.toHaveBeenCalled(); f.ui.destroy();
});
