// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { parsePublicJourneyPresentation } from "@raiquora/agent/public-journey-presentation";
import { renderPublicJourneyPresentation } from "./public-journey-presentation-view";
import { resolveAssistantMessage } from "./ai-guide-panel";

describe("public journey presentation view", () => {
  it("renders verified stations, trains, transfers without boilerplate", () => {
    const value = parsePublicJourneyPresentation({ version: "public-journey-presentation-v1", presentationId: "journey-presentation:test", serviceDate: "2026-09-24", originStation: "京都", destinationStation: "出雲市", evidenceRefs: ["journey:2026-09-24:0"], journeys: [{ id: "journey-1", departureTime: "08:00", arrivalTime: "12:00", durationMinutes: 240, transferCount: 1, legs: [{ originStation: "岡山", destinationStation: "出雲市", departureTime: "09:00", arrivalTime: "12:00", serviceUid: "s1", trainNumber: "1M", serviceType: "特急", trainName: "やくも", serviceDestination: "出雲市" }] }] });
    const root = renderPublicJourneyPresentation(value);
    expect(root.querySelectorAll(".journey-card")).toHaveLength(1);
    expect(root.textContent).toContain("京都 → 出雲市"); expect(root.textContent).toContain("特急 やくも 1M");
    expect(root.textContent).not.toContain("検証済み検索結果");
    const item = document.createElement("li"); item.scrollIntoView = vi.fn();
    const longText = "時刻や乗換を列挙する長い本文。".repeat(30);
    resolveAssistantMessage(item, { text: longText, publicJourneyPresentation: value }, { animate: false });
    expect(item.querySelector(".ai-guide-message-copy")?.textContent).toBe("経路1件を表示しました。パネルで比較できます。");
    expect(item.querySelector<HTMLDetailsElement>(".candidate-reply-details")?.open).toBe(false);
    expect(item.querySelector(".candidate-reply-details")?.textContent).toContain(longText);
    resolveAssistantMessage(item, { text: "通常の説明です。" }, { animate: false });
    expect(item.querySelector(".ai-guide-message-copy")?.textContent).toBe("通常の説明です。");
    expect(item.querySelector(".candidate-reply-details")).toBeNull();
  });
});
