export interface PhotoSourceDisclosureModel {
  url: string;
  sourcePageUrl?: string;
  attribution: string;
  license?: string;
}

export function createPhotoSourceDisclosure(
  photo: PhotoSourceDisclosureModel,
  accessibleName: string,
): HTMLElement {
  const container = document.createElement("span");
  container.className = "photo-source-disclosure";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "photo-source-disclosure-trigger";
  trigger.textContent = "i";
  trigger.ariaLabel = `${accessibleName}の出典情報`;
  trigger.setAttribute("aria-expanded", "false");

  const popover = document.createElement("span");
  popover.className = "photo-source-disclosure-popover";
  popover.hidden = true;
  popover.setAttribute("role", "dialog");
  popover.setAttribute("aria-label", `${accessibleName}の出典情報`);

  const attribution = document.createElement("strong");
  attribution.textContent = photo.attribution;
  popover.append(attribution);
  if (photo.license) {
    const license = document.createElement("small");
    license.textContent = `ライセンス: ${photo.license}`;
    popover.append(license);
  }
  appendUrl(popover, "掲載元", photo.sourcePageUrl);
  appendUrl(popover, "画像URL", photo.url);

  trigger.addEventListener("click", () => {
    const expanded = trigger.getAttribute("aria-expanded") !== "true";
    trigger.setAttribute("aria-expanded", String(expanded));
    popover.hidden = !expanded;
  });
  popover.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    popover.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    trigger.focus();
  });
  container.append(trigger, popover);
  return container;
}

function appendUrl(container: HTMLElement, label: string, value: string | undefined): void {
  const url = safePublicUrl(value);
  if (!url) return;
  const row = document.createElement("span");
  row.className = "photo-source-disclosure-link";
  const caption = document.createElement("small");
  caption.textContent = label;
  const text = document.createElement("code");
  text.textContent = url;
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "開く";
  row.append(caption, text, link);
  container.append(row);
}

function safePublicUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}
