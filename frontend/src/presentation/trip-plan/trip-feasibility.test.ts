// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { feasibilityTrip, feasibilityNow, feasibilityActivity, feasibilityStayTrip } from "../../../../modules/trip/domain/trip-feasibility.fixture";
import { requestTrip } from "../../../../modules/trip/domain/trip-request.fixture";
import { createTripWorkspaceController } from "../../usecases/trip-plan/trip-workspace-controller";
import { renderTripFeasibility } from "./trip-feasibility-view";
import { renderWorkspaceCard } from "./trip-workspace-card";
import { renderWorkspaceProposal } from "./trip-workspace-proposal";

it.each(["feasible", "unknown", "infeasible"] as const)("shows %s as distinct Japanese state and links affected item issues", (status) => {
  const trip = status === "infeasible" ? requestTrip(undefined, [feasibilityActivity(), feasibilityActivity("b")]) : feasibilityTrip();
  const controller = createTripWorkspaceController("s", () => new Date(feasibilityNow));
  controller.attach("s", { getCurrentTrip: () => trip, getReservationFacts: () => status === "unknown" ? undefined : [] });
  const evaluation = controller.feasibility()!;
  expect(evaluation.status).toBe(status);
  const section = renderTripFeasibility(evaluation);
  expect(section.dataset.feasibility).toBe(status);
  expect(section.querySelector("h2")!.textContent).toBe(`成立性: ${{ feasible: "成立", infeasible: "不成立", unknown: "未確認" }[status]}`);
  const card = renderWorkspaceCard(trip, trip.items[0]!, controller, { collapsed: false, collapse: vi.fn(), chat: vi.fn(), report: vi.fn() }, evaluation.issues.filter((i) => i.itemIds.includes(trip.items[0]!.id)));
  if (status === "infeasible") expect(card.textContent).toContain("予定の時間と順序が両立しません");
});
it("blocks unknown ready at UI and Application confirmation, but not ordinary draft repairs", async () => {
  const trip = feasibilityTrip(), writer = vi.fn(async () => {});
  const controller = createTripWorkspaceController("s", () => new Date(feasibilityNow));
  controller.attach("s", { getCurrentTrip: () => trip, confirmProposal: writer });
  controller.propose("完了にする", [{ type: "planning", state: "ready" }]);
  const section = renderWorkspaceProposal(trip, controller.proposal()!, controller, vi.fn());
  expect(section.textContent).toContain("準備完了にはできません");
  expect([...section.querySelectorAll("button")].find((b) => b.textContent!.startsWith("確認して"))!.disabled).toBe(true);
  await expect(controller.confirm()).rejects.toThrow("feasibility"); expect(writer).not.toHaveBeenCalled();
  controller.propose("下書きにする", [{ type: "planning", state: "itinerary_draft" }]);
  await controller.confirm(); expect(writer).toHaveBeenCalledOnce();
});
it("recomputes the proposed content, refuses stale preview and allows known feasible ready", async () => {
  let trip = { ...feasibilityTrip(), revision: 5 }; const writer = vi.fn(async () => {});
  const controller = createTripWorkspaceController("s", () => new Date(feasibilityNow));
  controller.attach("s", { getCurrentTrip: () => trip, getReservationFacts: () => [], confirmProposal: writer });
  expect(controller.feasibility()?.status).toBe("feasible");
  controller.propose("矛盾する変更と完了", [{ type: "add", item: feasibilityActivity("overlap") }, { type: "planning", state: "ready" }]);
  await expect(controller.confirm()).rejects.toThrow("feasibility"); expect(writer).not.toHaveBeenCalled();
  controller.propose("完了", [{ type: "planning", state: "ready" }]);
  await controller.confirm(); expect(writer).toHaveBeenCalledOnce();
  controller.propose("完了", [{ type: "planning", state: "ready" }]); trip = { ...trip, revision: 6 };
  await expect(controller.confirm()).rejects.toThrow(); expect(writer).toHaveBeenCalledOnce();
  expect(controller.feasibility()?.tripRevision).toBe(6);
});
it("permits overnight ready while visibly retaining unknown, using the same Application policy", async () => {
  const { trip, facts } = feasibilityStayTrip(), writer = vi.fn(async () => {});
  const controller = createTripWorkspaceController("s", () => new Date(feasibilityNow));
  controller.attach("s", { getCurrentTrip: () => trip, getReservationFacts: () => facts.reservations,
    getFeasibilityExternalFacts: () => facts.external, confirmProposal: writer });
  controller.propose("準備完了", [{ type: "planning", state: "ready" }]);
  const section = renderWorkspaceProposal(trip, controller.proposal()!, controller, vi.fn());
  expect(section.querySelector("[data-feasibility]")?.getAttribute("data-feasibility")).toBe("unknown");
  expect(section.textContent).toContain("すべて確認済みという意味ではありません");
  expect(section.textContent).toContain("採用済みの宿泊先の営業・利用条件は未取得です");
  expect([...section.querySelectorAll("button")].find((b) => b.textContent!.startsWith("確認して"))!.disabled).toBe(false);
  await controller.confirm(); expect(writer).toHaveBeenCalledOnce();
});
