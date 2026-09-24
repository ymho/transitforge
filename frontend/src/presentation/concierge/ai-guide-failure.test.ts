// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { configureAiGuidePanel } from "./ai-guide-panel";

it("marks a failed answer and lets the user retry the same prompt", async () => {
  document.body.innerHTML = '<section><ol></ol><form><input><button type="submit"></button></form></section>';
  const button = () => document.createElement("button");
  const select = () => document.createElement("select");
  const messages = document.querySelector("ol")!;
  const responses = [Promise.reject(new Error("limit_reached")), Promise.resolve("候補を見つけました")];
  const handlePrompt = vi.fn((_prompt: string) => responses.shift()!);
  let messageIndex = 0;
  const controller = configureAiGuidePanel({
    conversationSessionId: "conversation-a",
    panel: document.querySelector("section")!,
    toggle: button(),
    close: button(),
    messages,
    form: document.querySelector("form")!,
    input: document.querySelector("input")!,
    submit: document.querySelector("button")!,
    suggestions: [],
    contextChoices: document.createElement("div"),
    settingsToggle: button(),
    settingsPanel: document.createElement("div"),
    transferPace: select(),
    rankingPreference: select(),
    storage: localStorage,
    historyRepository: {
      list: () => [],
      append: vi.fn((_session, entry) => ({ ...entry, messageId: `message-${++messageIndex}` })),
      delete: vi.fn(),
    },
  }, handlePrompt);

  controller.ask("歴史ある街を歩きたい");
  await vi.waitFor(() => expect(messages.querySelector(".ai-guide-message-failure")).not.toBeNull());
  const retry = [...messages.querySelectorAll<HTMLButtonElement>("button")]
    .find((candidate) => candidate.textContent === "もう一度試す")!;
  expect(retry.disabled).toBe(false);

  retry.click();
  await vi.waitFor(() => expect(handlePrompt).toHaveBeenCalledTimes(2));
  expect(handlePrompt.mock.calls[1]?.[0]).toBe("歴史ある街を歩きたい");
  await vi.waitFor(() => expect(messages.textContent).toContain("候補を見つけました"));
});
