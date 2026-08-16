import type { ConciergeProfile } from "../features/concierge";

export interface ConciergeIdentityElements {
  avatar: HTMLImageElement;
  name: HTMLElement;
  role: HTMLElement;
  messages: HTMLOListElement;
}

export function renderConciergeIdentity(
  elements: ConciergeIdentityElements,
  concierge: ConciergeProfile,
  resetGreeting = false,
): void {
  elements.avatar.src = concierge.presentation.image;
  elements.avatar.alt = `${concierge.presentation.name}のアバター`;
  elements.name.textContent = concierge.presentation.name;
  elements.role.textContent = concierge.presentation.role;
  if (
    resetGreeting &&
    elements.messages.childElementCount === 1 &&
    !elements.messages.firstElementChild?.classList.contains("concierge-intro")
  ) {
    const firstMessage = elements.messages.firstElementChild;
    if (firstMessage instanceof HTMLElement) {
      firstMessage.textContent = concierge.conversation.greeting;
    }
  }
}
