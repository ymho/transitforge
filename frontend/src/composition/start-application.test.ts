// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { startApplication } from "./start-application";

beforeEach(() => { document.body.innerHTML = '<section id="startup-status">読み込み中</section><main id="app"></main>'; });
it("finishes authentication before importing Viewer and waits for its async startup", async () => {
  const order: string[] = [];
  let finish!: () => void;
  const pending = startApplication(async () => { order.push("auth"); }, async () => {
    order.push("import");
    return { startViewer: () => new Promise<void>(resolve => { finish = resolve; order.push("viewer"); }) };
  }, document);
  await vi.waitFor(() => expect(order).toEqual(["auth", "import", "viewer"]));
  expect(document.getElementById("startup-status")).not.toBeNull();
  finish(); await pending;
  expect(document.getElementById("startup-status")).toBeNull();
});
it.each(["auth", "import", "viewer"])("shows safe recovery for %s startup failure", async stage => {
  const error = new Error("private token/code/provider detail"), reload = vi.fn();
  const authenticate = vi.fn(async () => { if (stage === "auth") throw error; });
  const loadViewer = vi.fn(async () => {
    if (stage === "import") throw error;
    return { startViewer: async () => { if (stage === "viewer") throw error; } };
  });
  await startApplication(authenticate, loadViewer, document, reload);
  expect(document.getElementById("startup-status")!.getAttribute("role")).toBe("alert");
  expect(document.body.textContent).not.toContain("private");
  expect(document.getElementById("app")!.hidden).toBe(true);
  document.querySelector<HTMLButtonElement>("#startup-status button")!.click();
  expect(reload).toHaveBeenCalledOnce();
  if (stage === "auth") expect(loadViewer).not.toHaveBeenCalled();
});
