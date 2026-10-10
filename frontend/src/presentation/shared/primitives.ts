export type ProductIconName = "back" | "account" | "chat" | "close" | "compose" | "explore" | "notifications" | "send" | "train" | "trips" | "child" | "clock" | "settings" | "info" | "thumbUp" | "thumbDown";

const paths: Record<ProductIconName, string> = {
  back: '<path d="M19 12H5m6-6-6 6 6 6"/>',
  thumbUp: '<path d="M8 10v11H3V10zM8 10l5-8 2 1v7h5l1 2-3 9H8"/>',
  thumbDown: '<path d="M8 14V3H3v11zM8 14l5 8 2-1v-7h5l1-2-3-9H8"/>',
  child: '<circle cx="12" cy="7" r="2.5"/><path d="M7 17v-3a5 5 0 0 1 10 0v3M10 17v4M14 17v4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  settings: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="9" cy="18" r="2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  account: '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7 8a7 7 0 0 0-14 0"/>',
  chat: '<path d="M20 15a4 4 0 0 1-4 4H8l-4 2V7a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v8Z"/><path d="M8 9h8M8 13h5"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  compose: '<path d="M20 15a4 4 0 0 1-4 4H8l-4 2V7a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4"/><path d="M12 7v6M9 10h6"/>',
  explore: '<circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4"/>',
  notifications: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/>',
  send: '<path d="M12 19V5m-6 6 6-6 6 6"/>',
  train: '<rect x="5" y="3" width="14" height="15" rx="3"/><path d="M8 7h8M8 14h.01M16 14h.01M8 21l2-3M16 18l2 3"/>',
  trips: '<path d="M8 5h12v15H8zM4 9h4M4 13h4M4 17h4M11 9h6M11 13h6"/>',
};

/** Trusted fixed icon markup. Product navigation must not use Unicode glyphs as icons. */
export function iconMarkup(name: ProductIconName, label?: string): string {
  const accessible = label ? ` role="img" aria-label="${escapeAttribute(label)}"` : ' aria-hidden="true"';
  return `<svg class="ds-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"${accessible}>${paths[name]}</svg>`;
}

export function pageHeadingMarkup(eyebrow: string, title: string, description?: string): string {
  return `<header class="ds-page-heading">${eyebrow ? `<p class="ds-eyebrow">${escapeHtml(eyebrow)}</p>` : ""}<h1>${escapeHtml(title)}</h1>${description ? `<p class="ds-page-description">${escapeHtml(description)}</p>` : ""}</header>`;
}

export function createButton(document: Document, label: string, variant: "primary" | "secondary" | "ghost" | "icon" = "secondary"): HTMLButtonElement {
  const button = document.createElement("button"); button.type = "button"; button.className = `ds-button ds-button--${variant}`; button.textContent = label; return button;
}
export function adoptFormControl<T extends HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(control: T): T { control.classList.add("ds-control"); return control; }
export function createPageHeading(document: Document, eyebrow: string, title: string, description?: string): HTMLElement {
  const template = document.createElement("template"); template.innerHTML = pageHeadingMarkup(eyebrow, title, description); return template.content.firstElementChild as HTMLElement;
}
export function adoptComposer(form: HTMLFormElement, control: HTMLInputElement | HTMLTextAreaElement, submit: HTMLButtonElement): HTMLFormElement {
  form.classList.add("ds-composer"); adoptFormControl(control);
  // Scale only the field's visual presentation; keep its focus font at 16px on iOS.
  if (!control.parentElement?.classList.contains("ds-composer-field")) {
    const frame = control.ownerDocument.createElement("span"); frame.className = "ds-composer-field";
    control.before(frame); frame.append(control);
  }
  submit.classList.add("ds-button", "ds-button--primary"); return form;
}
export function createMediaCarousel(document: Document, items: HTMLElement[]): HTMLElement { const carousel = document.createElement("div"); carousel.className = "ds-media-carousel"; carousel.setAttribute("role", "region"); carousel.setAttribute("aria-label", "画像一覧"); carousel.append(...items); return carousel; }

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function escapeAttribute(value: string): string { return escapeHtml(value); }

/** Shared async status; preserves an accessible label without announcing decoration. */
export function loadingMarkup(label: string): string {
  const escaped = label.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return `<span class="ds-loading"><span class="ds-spinner" aria-hidden="true"></span><span>${escaped}</span></span>`;
}
export function setLoadingStatus(element: HTMLElement, label: string, busy: boolean): void {
  element.setAttribute("aria-busy", String(busy));
  if (busy) element.innerHTML = loadingMarkup(label); else element.textContent = label;
}
