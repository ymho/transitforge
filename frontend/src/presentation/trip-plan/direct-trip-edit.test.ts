// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { applyTripProposal } from "@raiquora/trip/trip";
import { multiCityTrip } from "../../../../modules/trip/domain/trip-places.fixture";
import { HttpServerTripClient } from "../../adapters/http/server-trip-client";
import { createServerTripWorkspaceSource } from "../../usecases/trip-plan/server-trip-workspace-source";
import { validateWorkspaceWriteConfirmation } from "../../usecases/trip-plan/workspace-write-confirmation";
import { createTripWorkspaceController } from "../../usecases/trip-plan/trip-workspace-controller";
import { renderTripTimeEditor } from "./trip-time-editor";
import { renderTripPartyControl } from "./trip-party-control";

afterEach(() => document.body.replaceChildren());
async function setup() {
  let server = multiCityTrip(), reject = false;
  const mutations = vi.fn();
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    const command = JSON.parse(init!.body as string);
    if (command.operation === "get") return new Response(JSON.stringify({ version: "trip-api-v1", trip: server, role: "owner" }));
    mutations(command);
    if (reject) return new Response(JSON.stringify({ version: "trip-api-v1", error: "conflict" }), { status: 409 });
    server = { ...applyTripProposal(server, command.proposal), revision: server.revision + 1 };
    return new Response(JSON.stringify({ version: "trip-api-v1", trip: server, revision: server.revision, mutationId: command.mutationId }));
  });
  const client = new HttpServerTripClient("/api/trips/v1", fetcher);
  const source = createServerTripWorkspaceSource(server.id, client, { mutate: request => client.mutate(request),
    newMutationId: () => crypto.randomUUID(), validateConfirmation: validateWorkspaceWriteConfirmation });
  const controller = createTripWorkspaceController("one"); controller.attach("one", source); await source.refresh();
  const previews: unknown[] = []; controller.subscribe(() => { if (controller.proposal()) previews.push(controller.proposal()); });
  return { controller, source, mutations, previews, server: () => server, reject: () => { reject = true; } };
}
const button = (root: ParentNode, label: string) => [...root.querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent === label)!;
function timeEditor(f: Awaited<ReturnType<typeof setup>>, itemIndex: number) {
  const trip = f.controller.current()!, root = renderTripTimeEditor(trip, trip.items[itemIndex]!, undefined, f.controller, vi.fn());
  document.body.append(root); button(root, "未定").click();
  const form = document.querySelector<HTMLFormElement>("dialog form")!;
  form.querySelector<HTMLInputElement>('input[type="date"]')!.value = itemIndex === 1 ? "2026-09-22" : "2026-09-23";
  form.querySelector<HTMLInputElement>('input[type="time"]')!.value = "20:30";
  return form;
}

it.each([1, 2])("saves stay/activity time through the real writer guard and HTTP read-back (%s)", async index => {
  const f = await setup(), before = structuredClone(f.server()), form = timeEditor(f, index);
  expect(button(form, "確定")).toBeDefined();
  form.dispatchEvent(new Event("submit", { cancelable: true }));
  form.dispatchEvent(new Event("submit", { cancelable: true }));
  await vi.waitFor(() => expect(form.hidden).toBe(true));
  expect(f.mutations).toHaveBeenCalledOnce(); expect(f.previews).toEqual([]);
  const after = f.server().items[index]!;
  if (after.type === "stay") {
    expect(after.plannedTiming?.checkIn?.at).toBe("2026-09-22T20:30:00+09:00");
    expect(after.selection).toEqual((before.items[index] as typeof after).selection);
  } else expect(after.schedule).toMatchObject({ type: "fixed", startAt: { at: "2026-09-23T20:30:00+09:00" } });
  expect(f.source.getCurrentTrip()).toEqual(f.server());
  await f.source.refresh(); expect(f.source.getCurrentTrip()).toEqual(f.server());
  expect(document.querySelector("dialog[open]")).toBeNull();
});

it("keeps failed time input and displays the rejection inside the editor", async () => {
  const f = await setup(), before = structuredClone(f.server()), form = timeEditor(f, 1); f.reject();
  document.querySelector(".trip-time-control")?.remove();
  form.dispatchEvent(new Event("submit", { cancelable: true }));
  await vi.waitFor(() => expect(form.querySelector('[role="status"]')?.textContent).toContain("旅程"));
  expect(form.hidden).toBe(false); expect(form.closest("dialog")?.open).toBe(true);
  expect(form.querySelector<HTMLInputElement>('input[type="time"]')!.value).toBe("20:30");
  expect(button(form, "確定").disabled).toBe(false);
  expect(f.server()).toEqual(before); expect(f.previews).toEqual([]);
});

it("saves party counts directly and rejects an editor from another session", async () => {
  const f = await setup(), root = renderTripPartyControl(f.controller.current()!, f.controller, vi.fn());
  document.body.append(root); root.querySelector<HTMLButtonElement>("button")!.click();
  const form = document.querySelector<HTMLFormElement>("dialog form")!, inputs = form.querySelectorAll("input");
  inputs[0]!.value = "2"; inputs[1]!.value = "1";
  form.dispatchEvent(new Event("submit", { cancelable: true }));
  await vi.waitFor(() => expect(form.hidden).toBe(true));
  expect(f.server().request.party).toMatchObject({ adults: 2, children: [{}] });
  expect(f.previews).toEqual([]); expect(f.mutations).toHaveBeenCalledOnce();
  f.controller.activateSession("two");
  form.dispatchEvent(new Event("submit", { cancelable: true }));
  expect(f.mutations).toHaveBeenCalledOnce();
});
