// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { renderPublicGroundRoutePresentation } from "./public-ground-route-presentation-view";
import { resolveAssistantMessage } from "./ai-guide-panel";
import { projectAssistantTurn } from "../../usecases/concierge/assistant-turn-projection";
import type { PublicGroundRoutePresentation } from "@raiquora/agent/public-ground-route-presentation";

it("renders source and a user-controlled map action without marking a route saved", () => {
  const value: PublicGroundRoutePresentation = { version: "public-ground-route-v1", evidenceId: "route-evidence", checkedAt: "2026-09-28T01:00:00Z",
    feedRetrievedAt: "2026-09-28T00:00:00Z", sourceUrl: "https://example.org/gtfs.zip", attribution: "Example",
    originName: "駅", destinationName: "宿", routes: [{ departureAt: "2026-10-01T09:00:00+09:00", arrivalAt: "2026-10-01T09:20:00+09:00",
      durationMinutes: 20, legs: [{ mode: "bus", originName: "駅", destinationName: "宿", departureAt: "2026-10-01T09:00:00+09:00", arrivalAt: "2026-10-01T09:20:00+09:00",
        geometry: [[132.7, 35.4], [132.8, 35.5]] }] }] };
  const callback = vi.fn(); const root = renderPublicGroundRoutePresentation(value, callback);
  expect(root.textContent).toContain("旅程には未採用");
  expect(root.querySelector("a")?.getAttribute("href")).toBe("https://example.org/gtfs.zip");
  (root.querySelector("button") as HTMLButtonElement).click();
  expect(callback).toHaveBeenCalledWith(value, 0);
  const live = projectAssistantTurn({ response: "検索しました", publicGroundRoutePresentation: value });
  const restored = projectAssistantTurn({ response: "検索しました", publicGroundRoutePresentation: value });
  const item = document.createElement("li");
  resolveAssistantMessage(item, live, undefined, undefined, undefined, undefined, false, undefined, callback);
  resolveAssistantMessage(item, restored, undefined, undefined, undefined, undefined, false, undefined, callback);
  expect(item.querySelectorAll('section[aria-label="徒歩・バスの経路候補"]')).toHaveLength(1);
});
