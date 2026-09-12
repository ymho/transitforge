// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { resolveAssistantMessage } from "./ai-guide-panel";
import type { ViewerAgentResponse } from "../../domain/viewer-agent-response";
import { runAskProgressCase } from "../../adapters/bedrock/ask-progress-scenarios.fixture";

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
  it("shows grounded findings and source links for the production response", async () => {
    const result = await runAskProgressCase("A-vague"); const item = render(result.response);
    expect(item.textContent).toContain("森の温泉郷");
    expect(item.textContent).toContain("出発する地域");
    expect(item.querySelector('a[href="https://example.com/nature"]')).not.toBeNull();
  });
  it("shows V2 candidate adoption facts without invoking the legacy writer", async () => {
    const result = await runAskProgressCase("C-candidate"); const apply = vi.fn(); const item = render(result.response, apply);
    expect(item.textContent).toContain("→"); expect(item.textContent).toContain("計画時刻");
    expect(item.querySelector(".trip-plan-update-apply")).toBeNull(); expect(apply).not.toHaveBeenCalled();
  });
});
