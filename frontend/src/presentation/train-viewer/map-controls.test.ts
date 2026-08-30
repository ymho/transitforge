import { afterEach, describe, expect, it, vi } from "vitest";

import { renderDisplayMode } from "./map-controls";

afterEach(() => vi.unstubAllGlobals());

describe("renderDisplayMode", () => {
  it("現在運行状況をサイドバーにも反映する", () => {
    vi.stubGlobal("document", { querySelector: () => null });
    const realtime = button();
    const dateTime = button();
    const elements = displayModeElements(realtime, dateTime);

    renderDisplayMode(elements, true, "digital-twin");

    expect(elements.app.dataset.displayMode).toBe("digital-twin");
    expect(realtime.ariaPressed).toBe("true");
    expect(dateTime.ariaPressed).toBe("false");
    expect(elements.dateTimeInput.disabled).toBe(true);
  });

  it("リアルタイム情報がなければ日時指定モードを示す", () => {
    vi.stubGlobal("document", { querySelector: () => null });
    const realtime = button();
    const dateTime = button();
    const elements = displayModeElements(realtime, dateTime);

    renderDisplayMode(elements, false, "simulation");

    expect(realtime.ariaPressed).toBe("false");
    expect(dateTime.ariaPressed).toBe("true");
    expect(elements.toggle.disabled).toBe(true);
    expect(elements.toggle.title).toContain("日時指定モード");
  });
});

function displayModeElements(
  realtime: HTMLButtonElement,
  dateTime: HTMLButtonElement,
) {
  const display = { setAttribute: vi.fn(), ariaExpanded: "false" } as unknown as HTMLElement;
  const dateTimeInput = {
    disabled: false,
    closest: () => display,
  } as unknown as HTMLInputElement;
  return {
    app: { dataset: {} } as HTMLElement,
    dateTimeInput,
    currentTimeButton: button(),
    toggle: button(),
    realtimeModeButtons: [realtime],
    dateTimeModeButtons: [dateTime],
  };
}

function button(): HTMLButtonElement {
  return {
    disabled: false,
    hidden: false,
    ariaPressed: "false",
    ariaLabel: "",
    title: "",
  } as HTMLButtonElement;
}
