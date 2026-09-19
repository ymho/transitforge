// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { resolveAssistantMessage } from "./ai-guide-panel";
import type { ViewerAgentResponse } from "../../domain/viewer-agent-response";

describe("Ask + Progress visible artifacts", () => {
  const question = { question: "昼食に希望はありますか", expectedInput: "free-text" as const, tripContext: {} };
  const render = (response: ViewerAgentResponse, onApply = vi.fn()) => {
    const item = document.createElement("li"); item.scrollIntoView = vi.fn();
    resolveAssistantMessage(item, response, undefined, onApply, undefined, undefined, undefined, undefined, false);
    return item;
  };
  it("renders a proposal and its question together instead of hiding the proposal", () => {
    const response = { text: "変更案です。昼食に希望はありますか", conversation: question,
      tripPlanUpdate: { summary: "提案", patches: [{ type: "remove" as const, itemId: "stay" }] } };
    const apply = vi.fn(); const item = render(response, apply);
    expect(item.textContent).toContain(question.question);
    expect(item.querySelector(".trip-plan-update-changes")?.textContent).toContain("削除");
    item.querySelector<HTMLButtonElement>(".trip-plan-update-apply")!.click();
    expect(apply).toHaveBeenCalledWith(response.tripPlanUpdate);
    expect(item.querySelectorAll(".conversation-feedback")).toHaveLength(1);
  });
});
