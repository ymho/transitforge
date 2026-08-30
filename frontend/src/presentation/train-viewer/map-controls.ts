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
  if (digitalTwinMode) {
    const picker = document.querySelector<HTMLElement>("#date-time-picker");
    if (picker) picker.hidden = true;
    if (display) display.ariaExpanded = "false";
  }
  elements.currentTimeButton.hidden = digitalTwinMode;
  elements.toggle.disabled = !realtimeAvailable;
  elements.toggle.ariaPressed = String(digitalTwinMode);
  for (const button of elements.realtimeModeButtons ?? []) {
    button.ariaPressed = String(digitalTwinMode);
  }
  for (const button of elements.dateTimeModeButtons ?? []) {
    button.ariaPressed = String(!digitalTwinMode);
  }
  if (!realtimeAvailable) {
    elements.toggle.ariaLabel = "リアルタイム情報がないため日時指定モード";
    elements.toggle.title = "リアルタイム情報がないため日時指定モード";
  } else if (digitalTwinMode) {
    elements.toggle.ariaLabel = "日時指定モードへ切り替え";
    elements.toggle.title = "現在運行状況";
  } else {
    elements.toggle.ariaLabel = "現在運行状況へ切り替え";
    elements.toggle.title = "日時指定モード";
  }
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
