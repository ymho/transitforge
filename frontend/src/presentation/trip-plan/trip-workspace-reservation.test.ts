// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { reservationFixture, reservationTripId } from "../../../../modules/trip/domain/reservation.fixture";
import { reservationStatuses, reservationFact, reservationChangeKey } from "@raiquora/trip/reservation";
import { createTrip } from "@raiquora/trip/trip";
import { createTripWorkspaceController } from "../../usecases/trip-plan/trip-workspace-controller";
import { reservationStatusLabels } from "../../usecases/trip-plan/reservation-reader";
import { createServerTripWorkspaceSource } from "../../usecases/trip-plan/server-trip-workspace-source";
import { renderWorkspaceCard } from "./trip-workspace-card";
import { renderWorkspaceProposal } from "./trip-workspace-proposal";
import { tripWorkspacePreviewSource } from "../../dev/trip-workspace-preview";

const item = { type: "activity" as const, id: "activity", title: "体験", category: "experience" as const, schedule: { type: "unscheduled" as const } };
const trip = createTrip(reservationTripId, "旅", "2026-09-13T00:00:00Z", [item]);
it.each(reservationStatuses)("ordinary card shows %s only when a Reservation exists; no reference", (status) => {
  const controller = createTripWorkspaceController("s");
  controller.attach("s", { getCurrentTrip: () => trip, getReservationFacts: () => [reservationFact(reservationFixture({ status }))] });
  const render = () => renderWorkspaceCard(trip, item, controller, { collapsed: false, collapse: vi.fn(), chat: vi.fn(), report: vi.fn() });
  const card = render(); expect(card.textContent).toContain(reservationStatusLabels[status]); expect(card.textContent).not.toContain("PRIVATE");
  controller.attach("s", { getCurrentTrip: () => trip, getReservationFacts: () => [] });
  expect(render().querySelector(".trip-workspace-reservation")).toBeNull();
});
it("booked remove preview requires checkbox confirmation and never changes a Reservation", async () => {
  const facts = [reservationFact(reservationFixture())], writer = vi.fn(async () => {}), controller = createTripWorkspaceController("s");
  controller.attach("s", { getCurrentTrip: () => trip, getReservationFacts: () => facts, confirmProposal: writer });
  controller.propose("削除案", [{ type: "remove", itemId: item.id }]);
  const proposal = controller.proposal()!, section = renderWorkspaceProposal(trip, proposal, controller, vi.fn());
  const confirm = [...section.querySelectorAll("button")].find((b) => b.textContent!.startsWith("確認して"))!;
  expect(confirm.disabled).toBe(true); expect(section.textContent).toContain("予約の変更・取消は別操作");
  await expect(controller.confirm()).rejects.toThrow("予約済み"); expect(writer).not.toHaveBeenCalled();
  const checkbox = section.querySelector<HTMLInputElement>('input[type="checkbox"]')!; checkbox.checked = true; checkbox.dispatchEvent(new Event("change"));
  expect(confirm.disabled).toBe(false); confirm.click();
  await vi.waitFor(() => expect(writer).toHaveBeenCalledWith(proposal, { reservationChangeKey: reservationChangeKey(proposal, facts) }));
  expect(facts[0]!.status).toBe("booked");
});
it("failed reservation read does not invent empty bookings or reuse stale facts", async () => {
  const list = vi.fn(async () => [reservationFact(reservationFixture())]);
  const source = createServerTripWorkspaceSource(trip.id, { get: async () => trip }, undefined, { list });
  await source.refresh(); expect(source.getReservationFacts?.()).toHaveLength(1);
  list.mockRejectedValueOnce(new Error("offline")); await source.refresh();
  expect(source.getCurrentTrip()).toEqual(trip); expect(source.getReservationFacts?.()).toBeUndefined();
});
it("a selected Stay is not a booking; only an independent record supplies its status", () => {
  const selectedTrip = tripWorkspacePreviewSource().getCurrentTrip()!;
  const stay = selectedTrip.items.find((i) => i.type === "stay")!;
  const controller = createTripWorkspaceController("stay");
  const render = () => renderWorkspaceCard(selectedTrip, stay, controller, { collapsed: false, collapse: vi.fn(), chat: vi.fn(), report: vi.fn() });
  controller.attach("stay", { getCurrentTrip: () => selectedTrip, getReservationFacts: () => [] });
  expect(render().querySelector(".trip-workspace-reservation")).toBeNull();
  controller.attach("stay", { getCurrentTrip: () => selectedTrip, getReservationFacts: () => [reservationFact(reservationFixture({
    tripId: selectedTrip.id, itineraryItemId: stay.id, kind: "accommodation", status: "booked",
  }))] });
  expect(render().textContent).toContain("予約済み");
  expect(render().textContent).not.toContain("PRIVATE");
});
