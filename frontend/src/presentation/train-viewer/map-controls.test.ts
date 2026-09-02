import { afterEach, describe, expect, it, vi } from "vitest";

import { renderDisplayMode } from "./map-controls";

afterEach(() => vi.unstubAllGlobals());

describe("renderDisplayMode", () => {
  it("リアルタイム運行状況をサイドバーにも反映する", () => {
    vi.stubGlobal("document", { querySelector: () => null });
    const realtime = button();
    const dateTime = button();
    const elements = displayModeElements(realtime, dateTime);

    renderDisplayMode(elements, true, "digital-twin");

    expect(elements.app.dataset.displayMode).toBe("digital-twin");
    expect(realtime.ariaPressed).toBe("true");
    expect(dateTime.ariaPressed).toBe("false");
    expect(elements.dateTimeInput.disabled).toBe(true);
    const display = elements.dateTimeInput.closest(".date-time-display");
    expect(display?.getAttribute("role")).toBe("group");
    expect(display?.getAttribute("tabindex")).toBe("-1");
    expect(elements.simulationOnlyControls?.every((control) => control.hidden)).toBe(true);
    expect(elements.realtimeOnlyControls?.every((control) => !control.hidden)).toBe(true);
  });

  it("リアルタイム情報がなければ日時指定シミュレーターを示す", () => {
    vi.stubGlobal("document", { querySelector: () => null });
    const realtime = button();
    const dateTime = button();
    const elements = displayModeElements(realtime, dateTime);

    renderDisplayMode(elements, false, "simulation");

    expect(realtime.ariaPressed).toBe("false");
    expect(dateTime.ariaPressed).toBe("true");
    expect(elements.toggle.disabled).toBe(true);
    expect(elements.toggle.title).toContain("日時指定シミュレーター");
    const display = elements.dateTimeInput.closest(".date-time-display");
    expect(display?.getAttribute("role")).toBe("button");
    expect(display?.getAttribute("tabindex")).toBe("0");
    expect(elements.simulationOnlyControls?.every((control) => !control.hidden)).toBe(true);
    expect(elements.realtimeOnlyControls?.every((control) => control.hidden)).toBe(true);
  });
});

function displayModeElements(
  realtime: HTMLButtonElement,
  dateTime: HTMLButtonElement,
) {
  const attributes = new Map<string, string>();
  const display = {
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name),
    getAttribute: (name: string) => attributes.get(name) ?? null,
    ariaExpanded: "false",
  } as unknown as HTMLElement;
  const dateTimeInput = {
    disabled: false,
    closest: () => display,
  } as unknown as HTMLInputElement;
  const currentTimeButton = button();
  const toggle = button();
  const simulationOnlyControls = [toggle, currentTimeButton, button(), button(), button()];
  const realtimeOnlyControls = [button()];
  return {
    app: { dataset: {} } as HTMLElement,
    dateTimeInput,
    currentTimeButton,
    toggle,
    realtimeModeButtons: [realtime],
    dateTimeModeButtons: [dateTime],
    simulationOnlyControls,
    realtimeOnlyControls,
  };
}

function button(): HTMLButtonElement {
  return {
    disabled: false,
    hidden: false,
    ariaPressed: "false",
    ariaLabel: "",
    title: "",
    setAttribute(name: string, value: string) {
      if (name === "aria-hidden") this.ariaHidden = value;
    },
  } as HTMLButtonElement;
}
