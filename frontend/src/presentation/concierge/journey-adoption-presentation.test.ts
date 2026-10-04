// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { resolveAssistantMessage } from "./ai-guide-panel";
import { consultationDesignFixture } from "./consultation-design.fixture";

it("combines the shown journey with its bound adoption action for live and restored replies", () => {
  for (const response of [consultationDesignFixture(), JSON.parse(JSON.stringify(consultationDesignFixture()))]) {
    const root = document.createElement("li"); resolveAssistantMessage(root, response, { animate: false });
    expect(root.querySelectorAll(".journey-presentation")).toHaveLength(1);
    expect(root.querySelector(".public-plan-presentation")).toBeNull();
    expect(root.querySelectorAll(".journey-card")).toHaveLength(3);
    expect(root.querySelector(".ai-guide-message-copy")?.textContent).toBe("経路3件を表示しました。パネルで比較できます。");
    const supplement = root.querySelector<HTMLDetailsElement>(".candidate-reply-details")!;
    expect(supplement.open).toBe(false);
    expect(supplement.querySelector("strong")?.textContent).toBe("経路1（推奨）");
    expect(supplement.querySelector("table")).not.toBeNull();
    root.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1]!.click();
    const event = vi.fn(); root.addEventListener("raiquora:preview-plan-adoption", event);
    root.querySelectorAll<HTMLButtonElement>(".public-plan-adopt")[1]!.click();
    expect(event.mock.calls[0]![0].detail).toMatchObject({ candidateSetId: "synthetic-set", variantId: "option-2", tripId: response.publicPlanPresentation.target!.tripId, baseTripRevision: 0 });
    expect(root.querySelectorAll<HTMLElement>(".journey-card")[1]!.hidden).toBe(false);
  }
});

it("does not merge plans with missing references, another date or extra activities", () => {
  for (const mismatch of ["source", "date", "activity"]) {
    const response = consultationDesignFixture(), candidate = structuredClone(response.publicPlanPresentation.candidates[0]!);
    if (mismatch === "source") Object.assign(candidate.items[0]!, { sourceRef: "different" });
    if (mismatch === "date") Object.assign(candidate.days[0]!, { label: "2026-09-14" });
    if (mismatch === "activity") Object.assign(candidate.items[0]!, { kind: "activity" });
    response.publicPlanPresentation = { ...response.publicPlanPresentation, candidates: [candidate, ...response.publicPlanPresentation.candidates.slice(1)] };
    const root = document.createElement("li"); resolveAssistantMessage(root, response, { animate: false });
    expect(root.querySelector(".public-plan-presentation")).not.toBeNull();
    expect(root.querySelector(".journey-adoptable")).toBeNull();
  }
});
