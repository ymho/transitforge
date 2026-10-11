interface SidebarMapModeElements {
  app: HTMLElement;
  realtimeModeButtons?: HTMLButtonElement[];
}

/** Navigation selection is independent of the map's background data mode. */
export function renderSidebarMapModeSelection(elements: SidebarMapModeElements): void {
  const fullscreenMap = elements.app.dataset.mapFocusMode === "true";
  for (const button of elements.realtimeModeButtons ?? []) {
    button.ariaPressed = String(fullscreenMap && elements.app.dataset.displayMode === "digital-twin");
  }
}

export function configureSidebarMapModeSelection(elements: SidebarMapModeElements): () => void {
  const render = () => renderSidebarMapModeSelection(elements);
  const observer = new MutationObserver(render);
  observer.observe(elements.app, { attributes: true, attributeFilter: ["data-map-focus-mode", "data-display-mode"] });
  render();
  return () => observer.disconnect();
}
