// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renderDisplayMode } from "./map-controls";

afterEach(() => { document.head.replaceChildren(); document.body.replaceChildren(); });

describe("map control hidden semantics with production CSS", () => {
  it.each([false, true])("keeps wrappers hidden across mode and sidebar switches (mobile=%s)", (mobile) => {
    const style = document.createElement("style");
    style.textContent = readFileSync(resolve(import.meta.dirname, "../styles/liquid-glass-foundation.css"), "utf8");
    document.head.append(style);
    document.body.innerHTML = `<main data-mobile="${mobile}"><div class="map-tools">
      <button id="toggle">mode</button><button id="now">now</button>
      <div class="playback-speed-menu"><button id="speed">1×</button></div>
      <fieldset id="simulation"><button>play</button></fieldset>
      <button id="congestion">congestion</button></div>
      <div class="date-time-display"><input id="time"></div></main>`;
    const get = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!;
    const elements = { app: get("main"), dateTimeInput: get<HTMLInputElement>("#time"),
      currentTimeButton: get<HTMLButtonElement>("#now"), toggle: get<HTMLButtonElement>("#toggle"),
      simulationOnlyControls: [get("#now"), get(".playback-speed-menu"), get("#simulation")],
      realtimeOnlyControls: [get("#congestion")] };
    // A control with a display:none ancestor is not a sequential keyboard target.
    const visible = (node: HTMLElement): boolean => getComputedStyle(node).display !== "none"
      && (!node.parentElement || visible(node.parentElement));
    for (const focusMode of ["true", "false", "true"]) {
      elements.app.dataset.mapFocusMode = focusMode;
      renderDisplayMode(elements, true, "simulation");
      expect(getComputedStyle(get(".playback-speed-menu")).display).toBe("grid");
      expect(visible(get("#speed"))).toBe(true);
      expect(visible(get("#congestion"))).toBe(false);
      renderDisplayMode(elements, true, "digital-twin");
      for (const node of elements.simulationOnlyControls) expect(getComputedStyle(node).display).toBe("none");
      expect(visible(get("#speed"))).toBe(false);
      expect(visible(get("#congestion"))).toBe(true);
      renderDisplayMode(elements, false, "simulation");
      expect(visible(get("#speed"))).toBe(true);
      expect(visible(get("#congestion"))).toBe(false);
      expect(elements.toggle.disabled).toBe(true);
    }
  });
});
