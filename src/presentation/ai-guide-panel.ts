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

    void handlePrompt(prompt)
      .then((response) => appendMessage(messages, "assistant", response))
      .catch(() =>
        appendMessage(
          messages,
          "assistant",
          "案内を開始できませんでした。時間をおいてもう一度お試しください。",
        ),
      )
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
  item.textContent = text;
  messages.append(item);
  item.scrollIntoView({ block: "nearest" });
}
