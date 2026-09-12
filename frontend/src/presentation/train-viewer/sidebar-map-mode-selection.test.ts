// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { configureSidebarMapModeSelection, renderSidebarMapModeSelection } from "./map-controls";

afterEach(() => document.body.replaceChildren());
function elements() {
  const app = document.createElement("main"); document.body.append(app);
  return { app, realtimeModeButtons: [document.createElement("button"), document.createElement("button")],
    dateTimeModeButtons: [document.createElement("button"), document.createElement("button")] };
}
describe("sidebar map navigation selection", () => {
  it.each(["digital-twin", "simulation"])("does not select either mode in chat: %s", (mode) => {
    const ui = elements(); ui.app.dataset.displayMode = mode;
    renderSidebarMapModeSelection(ui);
    expect([...ui.realtimeModeButtons, ...ui.dateTimeModeButtons].every((button) => button.ariaPressed === "false")).toBe(true);
  });
  it("tracks full-screen navigation and actual mode changes for sidebar and rail", async () => {
    const ui = elements(); ui.app.dataset.displayMode = "digital-twin";
    const stop = configureSidebarMapModeSelection(ui);
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
    ui.app.dataset.mapFocusMode = "true"; await flush();
    expect(ui.realtimeModeButtons.every((button) => button.ariaPressed === "true")).toBe(true);
    ui.app.dataset.displayMode = "simulation"; await flush();
    expect(ui.realtimeModeButtons.every((button) => button.ariaPressed === "false")).toBe(true);
    expect(ui.dateTimeModeButtons.every((button) => button.ariaPressed === "true")).toBe(true);
    delete ui.app.dataset.mapFocusMode; await flush();
    expect([...ui.realtimeModeButtons, ...ui.dateTimeModeButtons].every((button) => button.ariaPressed === "false")).toBe(true);
    expect(ui.app.dataset.displayMode).toBe("simulation");
    stop();
  });
});
