export type ProductIconName = "account" | "chat" | "close" | "compose" | "explore" | "notifications" | "send" | "train" | "trips";

const paths: Record<ProductIconName, string> = {
  account: '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7 8a7 7 0 0 0-14 0"/>',
  chat: '<path d="M20 15a4 4 0 0 1-4 4H8l-4 2V7a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v8Z"/><path d="M8 9h8M8 13h5"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  compose: '<path d="M20 15a4 4 0 0 1-4 4H8l-4 2V7a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4"/><path d="M12 7v6M9 10h6"/>',
  explore: '<circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4"/>',
  notifications: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/>',
  send: '<path d="m4 12 16-8-6 16-2.5-6.5L4 12Z"/><path d="m11.5 13.5 3-3"/>',
  train: '<rect x="5" y="3" width="14" height="15" rx="3"/><path d="M8 7h8M8 14h.01M16 14h.01M8 21l2-3M16 18l2 3"/>',
  trips: '<path d="M8 5h12v15H8zM4 9h4M4 13h4M4 17h4M11 9h6M11 13h6"/>',
};

/** Trusted fixed icon markup. Product navigation must not use Unicode glyphs as icons. */
export function iconMarkup(name: ProductIconName, label?: string): string {
  const accessible = label ? ` role="img" aria-label="${escapeAttribute(label)}"` : ' aria-hidden="true"';
  return `<svg class="ds-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"${accessible}>${paths[name]}</svg>`;
}

export function pageHeadingMarkup(eyebrow: string, title: string, description?: string): string {
  return `<header class="ds-page-heading"><p class="ds-eyebrow">${escapeHtml(eyebrow)}</p><h1>${escapeHtml(title)}</h1>${description ? `<p class="ds-page-description">${escapeHtml(description)}</p>` : ""}</header>`;
}

export function createButton(document: Document, label: string, variant: "primary" | "secondary" | "ghost" | "icon" = "secondary"): HTMLButtonElement {
  const button = document.createElement("button"); button.type = "button"; button.className = `ds-button ds-button--${variant}`; button.textContent = label; return button;
}
export function adoptFormControl<T extends HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(control: T): T { control.classList.add("ds-control"); return control; }
export function createSurface(document: Document, tag: "section" | "article" | "div" = "section"): HTMLElement { const surface = document.createElement(tag); surface.className = "ds-surface"; return surface; }
export function createDivider(document: Document): HTMLHRElement { const divider = document.createElement("hr"); divider.className = "ds-divider"; return divider; }
export function createChip(document: Document, label: string): HTMLSpanElement { const chip = document.createElement("span"); chip.className = "ds-chip"; chip.textContent = label; return chip; }
export function createEmptyState(document: Document, message: string): HTMLElement { const state = document.createElement("div"); state.className = "ds-empty-state"; state.setAttribute("role", "status"); state.textContent = message; return state; }
export function createPageHeading(document: Document, eyebrow: string, title: string, description?: string): HTMLElement {
  const template = document.createElement("template"); template.innerHTML = pageHeadingMarkup(eyebrow, title, description); return template.content.firstElementChild as HTMLElement;
}
export function createSectionHeading(document: Document, title: string): HTMLHeadingElement { const heading = document.createElement("h2"); heading.className = "ds-section-heading"; heading.textContent = title; return heading; }
export function adoptComposer(form: HTMLFormElement, control: HTMLInputElement | HTMLTextAreaElement, submit: HTMLButtonElement): HTMLFormElement {
  form.classList.add("ds-composer"); adoptFormControl(control); submit.classList.add("ds-button", "ds-button--primary"); return form;
}
export function createMediaFrame(document: Document, image: HTMLImageElement): HTMLElement { const frame = document.createElement("figure"); frame.className = "ds-media-frame"; frame.append(image); return frame; }
export function createMediaCarousel(document: Document, items: HTMLElement[]): HTMLElement { const carousel = document.createElement("div"); carousel.className = "ds-media-carousel"; carousel.setAttribute("role", "region"); carousel.setAttribute("aria-label", "画像一覧"); carousel.append(...items); return carousel; }
export function createSourceDisclosure(document: Document, text: string): HTMLElement { const disclosure = document.createElement("small"); disclosure.className = "ds-source-disclosure"; disclosure.textContent = text; return disclosure; }

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function escapeAttribute(value: string): string { return escapeHtml(value); }
