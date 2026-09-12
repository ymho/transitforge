export interface VisualizationController {
  setEnabled(enabled: boolean): void;
}

export interface DestinationArcLayer {
  setDestinationArcsVisible(visible: boolean): void;
}

export interface DisplayModeElements {
  app: HTMLElement;
  dateTimeInput: HTMLInputElement;
  currentTimeButton: HTMLButtonElement;
  toggle: HTMLButtonElement;
  realtimeModeButtons?: HTMLButtonElement[];
  dateTimeModeButtons?: HTMLButtonElement[];
  simulationOnlyControls?: HTMLElement[];
  realtimeOnlyControls?: HTMLElement[];
}

export function renderDisplayMode(
  elements: DisplayModeElements,
  realtimeAvailable: boolean,
  mode: "digital-twin" | "simulation",
): void {
  const digitalTwinMode = mode === "digital-twin";
  elements.app.dataset.displayMode = mode;
  elements.dateTimeInput.disabled = digitalTwinMode;
  const display = elements.dateTimeInput.closest<HTMLElement>(".date-time-display");
  display?.setAttribute("aria-disabled", String(digitalTwinMode));
  if (display) {
    display.setAttribute("role", digitalTwinMode ? "group" : "button");
    display.setAttribute("tabindex", digitalTwinMode ? "-1" : "0");
    if (digitalTwinMode) display.removeAttribute("aria-haspopup");
    else display.setAttribute("aria-haspopup", "dialog");
  }
  if (digitalTwinMode) {
    const picker = document.querySelector<HTMLElement>("#date-time-picker");
    if (picker) picker.hidden = true;
    if (display) display.ariaExpanded = "false";
  }
  elements.currentTimeButton.hidden = digitalTwinMode;
  for (const control of elements.simulationOnlyControls ?? []) {
    control.hidden = digitalTwinMode;
    control.setAttribute("aria-hidden", String(digitalTwinMode));
  }
  for (const control of elements.realtimeOnlyControls ?? []) {
    control.hidden = !digitalTwinMode;
    control.setAttribute("aria-hidden", String(!digitalTwinMode));
  }
  elements.toggle.disabled = !realtimeAvailable;
  elements.toggle.ariaPressed = String(digitalTwinMode);
  renderSidebarMapModeSelection(elements);
  if (!realtimeAvailable) {
    elements.toggle.ariaLabel = "リアルタイム情報がないため日時指定シミュレーター";
    elements.toggle.title = "リアルタイム情報がないため日時指定シミュレーター";
  } else if (digitalTwinMode) {
    elements.toggle.ariaLabel = "日時指定シミュレーターへ切り替え";
    elements.toggle.title = "リアルタイム運行状況";
  } else {
    elements.toggle.ariaLabel = "リアルタイム運行状況へ切り替え";
    elements.toggle.title = "日時指定シミュレーター";
  }
}

type SidebarMapModeElements = Pick<DisplayModeElements, "app" | "realtimeModeButtons" | "dateTimeModeButtons">;

/** Navigation selection is independent of the map's background data mode. */
export function renderSidebarMapModeSelection(elements: SidebarMapModeElements): void {
  const fullscreenMap = elements.app.dataset.mapFocusMode === "true";
  for (const button of elements.realtimeModeButtons ?? []) {
    button.ariaPressed = String(fullscreenMap && elements.app.dataset.displayMode === "digital-twin");
  }
  for (const button of elements.dateTimeModeButtons ?? []) {
    button.ariaPressed = String(fullscreenMap && elements.app.dataset.displayMode === "simulation");
  }
}

export function configureSidebarMapModeSelection(elements: SidebarMapModeElements): () => void {
  const render = () => renderSidebarMapModeSelection(elements);
  const observer = new MutationObserver(render);
  observer.observe(elements.app, { attributes: true, attributeFilter: ["data-map-focus-mode", "data-display-mode"] });
  render();
  return () => observer.disconnect();
}

export function configureDestinationArcs(
  trainLayer: DestinationArcLayer,
  toggle: HTMLButtonElement,
): VisualizationController {
  let requested = false;
  const apply = () => {
    toggle.disabled = false;
    toggle.ariaPressed = String(requested);
    toggle.title = "行先アーチ";
    toggle.ariaLabel = "行先アーチ";
    trainLayer.setDestinationArcsVisible(requested);
  };
  const setEnabled = (nextEnabled: boolean) => {
    requested = nextEnabled;
    apply();
  };
  toggle.addEventListener("click", () => setEnabled(!requested));
  apply();
  return { setEnabled };
}
