export interface AiGuidePanelElements {
  panel: HTMLElement;
  toggle: HTMLButtonElement;
  close: HTMLButtonElement;
  messages: HTMLOListElement;
  form: HTMLFormElement;
  input: HTMLInputElement;
  submit: HTMLButtonElement;
  suggestions: HTMLButtonElement[];
}

export type AiGuidePromptHandler = (prompt: string) => Promise<string>;

export function configureAiGuidePanel(
  elements: AiGuidePanelElements,
  handlePrompt: AiGuidePromptHandler,
): void {
  const { panel, toggle, close, messages, form, input, submit, suggestions } =
    elements;

  const setOpen = (open: boolean) => {
    panel.hidden = !open;
    toggle.ariaExpanded = String(open);
    if (open) {
      input.focus();
    } else {
      toggle.focus();
    }
  };

  toggle.addEventListener("click", () => setOpen(panel.hidden));
  close.addEventListener("click", () => setOpen(false));
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setOpen(false);
    }
  });

  for (const suggestion of suggestions) {
    suggestion.addEventListener("click", () => {
      input.value = suggestion.dataset.prompt ?? suggestion.textContent ?? "";
      input.focus();
    });
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const prompt = input.value.trim();
    if (!prompt || submit.disabled) {
      return;
    }

    appendMessage(messages, "user", prompt);
    input.value = "";
    input.disabled = true;
    submit.disabled = true;
    submit.textContent = "送信中";
    const pendingMessage = appendPendingMessage(messages);

    void handlePrompt(prompt)
      .then((response) => {
        resolveAssistantMessage(pendingMessage, response);
      })
      .catch(() => {
        resolveAssistantMessage(
          pendingMessage,
          "案内を開始できませんでした。時間をおいてもう一度お試しください。",
        );
      })
      .finally(() => {
        input.disabled = false;
        submit.disabled = false;
        submit.textContent = "送信";
        input.focus();
      });
  });
}

function appendMessage(
  messages: HTMLOListElement,
  role: "assistant" | "user",
  text: string,
): void {
  const item = document.createElement("li");
  item.className = `ai-guide-message ai-guide-message-${role}`;
  item.textContent = role === "assistant" ? visibleAssistantText(text) : text;
  messages.append(item);
  item.scrollIntoView({ block: "nearest" });
}

function appendPendingMessage(messages: HTMLOListElement): HTMLLIElement {
  const item = document.createElement("li");
  item.className =
    "ai-guide-message ai-guide-message-assistant ai-guide-message-pending";
  item.setAttribute("aria-label", "AIが回答を準備しています");

  const label = document.createElement("span");
  label.textContent = "考え中";
  const dots = document.createElement("span");
  dots.className = "ai-guide-thinking-dots";
  dots.setAttribute("aria-hidden", "true");
  for (let index = 0; index < 3; index += 1) {
    dots.append(document.createElement("i"));
  }

  item.append(label, dots);
  messages.append(item);
  item.scrollIntoView({ block: "nearest" });
  return item;
}

function resolveAssistantMessage(item: HTMLLIElement, text: string): void {
  item.classList.remove("ai-guide-message-pending");
  item.removeAttribute("aria-label");
  item.textContent = visibleAssistantText(text);
  item.scrollIntoView({ block: "nearest" });
}

export function visibleAssistantText(text: string): string {
  const responseBlocks = Array.from(
    text.matchAll(/<response\b[^>]*>([\s\S]*?)<\/response>/gi),
    (match) => withoutThinking(match[1] ?? "").trim(),
  ).filter(Boolean);
  if (responseBlocks.length > 0) {
    return responseBlocks.join("\n\n");
  }

  const visibleSource = withoutThinking(text);
  const unclosedResponse = visibleSource.match(
    /<response\b[^>]*>([\s\S]*)$/i,
  )?.[1];
  const visibleText = (unclosedResponse ?? visibleSource)
    .replace(/<\/?response\b[^>]*>/gi, "")
    .trim();
  return visibleText || "案内を完了しました。";
}

function withoutThinking(text: string): string {
  return text
    .replace(/<thinking\b[^>]*>[\s\S]*?<\/thinking>/gi, "")
    .replace(/<thinking\b[^>]*>[\s\S]*$/gi, "")
    .replace(/<\/?thinking\b[^>]*>/gi, "");
}
