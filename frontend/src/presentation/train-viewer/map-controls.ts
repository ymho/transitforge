import { isWeatherMode, type WeatherMode } from "../../domain/weather";

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
  if (!realtimeAvailable) {
    elements.toggle.ariaLabel = "リアルタイム情報がないためシミュレーションモード";
    elements.toggle.title = "リアルタイム情報がないためシミュレーションモード";
  } else if (digitalTwinMode) {
    elements.toggle.ariaLabel = "デジタルツインモードを終了";
    elements.toggle.title = "デジタルツインモード: オン";
  } else {
    elements.toggle.ariaLabel = "デジタルツインモードを開始";
    elements.toggle.title = "デジタルツインモード: オフ";
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

export function configureWeather<Map>(
  map: Map,
  buttons: HTMLButtonElement[],
  menuToggle: HTMLButtonElement,
  options: HTMLFieldSetElement,
  onWeatherChanged: (mode: WeatherMode) => void,
  applyWeatherMode: (map: Map, mode: WeatherMode) => void,
): (mode: WeatherMode) => void {
  const weatherPresentation: Record<WeatherMode, { icon: string; label: string }> = {
    clear: { icon: "icon-sun", label: "晴れ" },
    cloudy: { icon: "icon-cloud", label: "曇り" },
    rain: { icon: "icon-rain", label: "雨" },
    snow: { icon: "icon-snow", label: "雪" },
  };
  const closeMenu = () => {
    options.hidden = true;
    menuToggle.ariaExpanded = "false";
  };
  const selectWeather = (mode: WeatherMode) => {
    applyWeatherMode(map, mode);
    onWeatherChanged(mode);
    for (const button of buttons) {
      button.ariaPressed = String(button.dataset.weather === mode);
    }
    const presentation = weatherPresentation[mode];
    setMapToolIcon(menuToggle, presentation.icon);
    menuToggle.ariaLabel = `天気を選択（現在は${presentation.label}）`;
    menuToggle.title = `天気: ${presentation.label}`;
    closeMenu();
  };

  menuToggle.disabled = false;
  menuToggle.addEventListener("click", () => {
    const open = options.hidden;
    options.hidden = !open;
    menuToggle.ariaExpanded = String(open);
  });
  for (const button of buttons) {
    button.disabled = false;
    button.addEventListener("click", () => {
      const mode = button.dataset.weather;
      if (isWeatherMode(mode)) selectWeather(mode);
    });
  }
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (target instanceof Node && !options.contains(target) && !menuToggle.contains(target)) {
      closeMenu();
    }
  });

  selectWeather("clear");
  return selectWeather;
}

function setMapToolIcon(button: HTMLButtonElement, symbolId: string): void {
  button.querySelector<SVGUseElement>("use")?.setAttribute("href", `#${symbolId}`);
}
