import {
  createDigitalTwinClockSynchronizer,
  type DigitalTwinClockEnvironment,
} from "../../domain/digital-twin-clock";
import { currentRouteTime } from "../../domain/playback";
import { PlaybackController } from "../../domain/playback-controller";

const minimumPlaybackRenderIntervalMilliseconds = 1_000 / 30;

export interface PlaybackSpeedUiController {
  setEnabled(enabled: boolean): void;
  selectRealtimeSpeed(): void;
}

export interface PlaybackUiController {
  setDigitalTwinMode(enabled: boolean): void;
}

export interface PlaybackElements {
  displayTime: HTMLInputElement;
  playToggle: HTMLButtonElement;
  currentTimeButton: HTMLButtonElement;
  playbackSpeed: HTMLInputElement;
}

export function configurePlayback(
  elements: PlaybackElements,
  updateTrains: (routeTime?: number) => void,
  maximumRouteTime: number,
  onCurrentDateSelected: (date: Date) => void,
  onOperatingDayWrapped: () => void,
  speedControls: PlaybackSpeedUiController,
  clockEnvironment: DigitalTwinClockEnvironment,
): PlaybackUiController {
  const { displayTime, playToggle, currentTimeButton, playbackSpeed } = elements;
  const range = { minimum: Number(displayTime.min), maximum: maximumRouteTime };
  const controller = new PlaybackController({
    initialRouteTime: Number(displayTime.value),
    range,
    getMinutesPerSecond: () => Number(playbackSpeed.value),
    render: (routeTime) => {
      displayTime.value = String(routeTime);
      updateTrains(routeTime);
    },
    onOperatingDayWrapped,
    minimumRenderIntervalMilliseconds: minimumPlaybackRenderIntervalMilliseconds,
  });
  const renderPlaybackState = () => {
    const playing = controller.isPlaying();
    setMapToolIcon(playToggle, playing ? "icon-pause" : "icon-play");
    playToggle.ariaLabel = playing ? "一時停止" : "再生";
    playToggle.title = playing ? "一時停止" : "再生";
  };
  const digitalTwinClock = createDigitalTwinClockSynchronizer((now) => {
    onCurrentDateSelected(now);
    const routeTime = currentRouteTime(now);
    controller.synchronize(
      Math.min(Math.max(routeTime, range.minimum), range.maximum),
    );
  }, clockEnvironment);

  displayTime.addEventListener("input", () => {
    controller.seek(Number(displayTime.value), false);
  });
  playToggle.addEventListener("click", () => {
    if (playToggle.disabled) return;
    controller.isPlaying() ? controller.stop() : controller.start();
    renderPlaybackState();
  });
  currentTimeButton.addEventListener("click", () => {
    const now = new Date();
    onCurrentDateSelected(now);
    const routeTime = currentRouteTime(now);
    controller.seek(Math.min(Math.max(routeTime, range.minimum), range.maximum));
  });

  controller.start();
  renderPlaybackState();
  let digitalTwinMode: boolean | undefined;
  return {
    setDigitalTwinMode(enabled) {
      if (enabled === digitalTwinMode) return;
      digitalTwinMode = enabled;
      digitalTwinClock.setEnabled(enabled);
      if (enabled) {
        speedControls.selectRealtimeSpeed();
        controller.start();
      }
      playToggle.disabled = enabled;
      playToggle.title = enabled
        ? "リアルタイム運行状況では常時再生"
        : controller.isPlaying() ? "一時停止" : "再生";
      playToggle.ariaLabel = playToggle.title;
      speedControls.setEnabled(!enabled);
      setMapToolIcon(playToggle, controller.isPlaying() ? "icon-pause" : "icon-play");
    },
  };
}

export function configurePlaybackSpeed(
  value: HTMLInputElement,
  buttons: HTMLButtonElement[],
  menuToggle: HTMLButtonElement,
  options: HTMLFieldSetElement,
): PlaybackSpeedUiController {
  const closeMenu = () => {
    options.hidden = true;
    menuToggle.ariaExpanded = "false";
  };
  const selectSpeed = (speed: string, label: string) => {
    value.value = speed;
    menuToggle.textContent = label;
    menuToggle.ariaLabel = `再生速度を選択（現在は${label.replace("×", "倍")}）`;
    menuToggle.title = `再生速度: ${label.replace("×", "倍")}`;
    for (const button of buttons) {
      button.ariaPressed = String(button.dataset.playbackSpeed === speed);
    }
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
      const speed = button.dataset.playbackSpeed;
      const label = button.dataset.playbackSpeedLabel;
      if (speed && label) selectSpeed(speed, label);
    });
  }
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (target instanceof Node && !options.contains(target) && !menuToggle.contains(target)) {
      closeMenu();
    }
  });

  const selectedButton = buttons.find(
    (button) => button.dataset.playbackSpeed === value.value,
  );
  selectSpeed(value.value, selectedButton?.dataset.playbackSpeedLabel ?? "1×");
  return {
    setEnabled(enabled) {
      menuToggle.disabled = !enabled;
      for (const button of buttons) button.disabled = !enabled;
      if (!enabled) closeMenu();
    },
    selectRealtimeSpeed() {
      const realtimeButton = buttons.find(
        (button) => button.dataset.playbackSpeedLabel === "1×",
      );
      selectSpeed(
        realtimeButton?.dataset.playbackSpeed ?? "0.016666666666666666",
        realtimeButton?.dataset.playbackSpeedLabel ?? "1×",
      );
    },
  };
}

function setMapToolIcon(button: HTMLButtonElement, symbolId: string): void {
  button.querySelector<SVGUseElement>("use")?.setAttribute("href", `#${symbolId}`);
}
