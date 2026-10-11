// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { configureTripLibrary } from "./trip-library-panel";
import { createTrip } from "@raiquora/trip/trip";
import type { OfficialGuide } from "@raiquora/trip/official-guide";
const id = "11111111-1111-4111-8111-111111111111", at = "2026-09-14T02:00:00.000Z";
const trip = createTrip(id, "公式の海", at);
const guide: OfficialGuide = { id, version: 1, publishedAt: at, trip };
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });
function setup(officialOnly = false, initiallyAuthenticated = true) {
  const root = document.createElement("section"), own = document.createElement("div"); root.append(own); document.body.append(root);
  const client = { accessible: vi.fn(async () => ({ trips: [{ trip, role: "viewer" as const }] })), ownedShared: vi.fn(async () => ({ trips: [] })), officialCapabilities: vi.fn(async () => false),
    officialList: vi.fn(async () => ({ guides: [guide] })), officialGet: vi.fn(async () => guide), officialPublish: vi.fn(async () => {}), officialWithdraw: vi.fn(async () => {}),
    officialImport: vi.fn(async () => trip) };
  let session = 1, authenticated = initiallyAuthenticated; const login = vi.fn(); const openTrip = vi.fn(async () => {});
  const ui = configureTripLibrary(root, own, client, { openTrip, session: () => session, authenticated: () => authenticated, officialOnly, login });
  const click = (label: string) => [...document.querySelectorAll("button")].find(b => b.textContent === label)!.click();
  return { root, own, client, openTrip, ui, click, login, logout: () => { authenticated = false; session++; ui.refresh(); }, signIn: (changeSession = true) => { authenticated = true; if (changeSession) session++; ui.refresh(); }, switchAccount: () => { session++; ui.refresh(); } };
}
describe("Trip catalogue sharing and official guide navigation", () => {
  it("keeps only own and shared tabs; displays server roles and opens shared Trip", async () => {
    const f = setup(); expect(f.client.accessible).not.toHaveBeenCalled(); f.click("共有中の旅");
    expect(f.own.hidden).toBe(true); await vi.waitFor(() => expect(f.root.textContent).toContain("共有 · 閲覧のみ"));
    f.click("旅程を開く"); expect(f.openTrip).toHaveBeenCalledWith(id);
    expect([...f.root.querySelectorAll('[role="tab"]')].map(b => b.textContent)).toEqual(["あなたの旅", "共有中の旅"]);
    f.click("あなたの旅"); expect(f.own.hidden).toBe(false);
  });
  it("loads official guides on home only after login and clears late responses on logout", async () => {
    const f = setup(true, false);
    expect(f.client.officialList).not.toHaveBeenCalled(); expect(f.root.querySelector('[role="tab"]')).toBeNull();
    f.click("ログイン"); expect(f.login).toHaveBeenCalledOnce();
    let resolve!: (v: { guides: OfficialGuide[] }) => void;
    f.client.officialList.mockReturnValueOnce(new Promise(r => { resolve = r; })); f.signIn();
    expect(f.root.querySelector('[aria-busy="true"]')).not.toBeNull(); f.logout(); resolve({ guides: [guide] });
    await Promise.resolve(); expect(f.root.textContent).not.toContain("公式の海");
    f.signIn(); await vi.waitFor(() => expect(f.root.textContent).toContain("公式の海"));
    f.click("再読み込み"); await vi.waitFor(() => expect(f.client.officialList).toHaveBeenCalledTimes(3));
  });
  it("removes the login prompt when authentication becomes available without a session counter change", async () => {
    const f = setup(true, false); expect(f.root.textContent).toContain("ログインすると");
    f.signIn(false); await vi.waitFor(() => expect(f.root.textContent).toContain("公式の海"));
    expect(f.root.textContent).not.toContain("ログインすると");
    expect([...f.root.querySelectorAll("button")].some(button => button.textContent === "ログイン")).toBe(false);
    f.ui.dispose();
  });
  it("creates from explicit date/party, retains a stable retry ID, closes stale account dialogs", async () => {
    vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function (this: HTMLDialogElement) { this.open = true; });
    vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (this: HTMLDialogElement) { this.open = false; });
    const f = setup(true); await vi.waitFor(() => expect(f.root.textContent).toContain("公式の海"));
    f.click("しおりを見る"); await vi.waitFor(() => expect(document.querySelector("dialog")).not.toBeNull());
    const dialog = document.querySelector("dialog")!, form = dialog.querySelector("form")!; vi.spyOn(form, "reportValidity").mockReturnValue(true);
    dialog.querySelector<HTMLInputElement>('input[type="date"]')!.value = "2026-12-31";
    f.client.officialImport.mockRejectedValueOnce(new Error("lost")); form.dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() => expect(dialog.textContent).toContain("再試行してください"));
    const attempted = f.client.officialImport.mock.calls[0]; form.dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() => expect(f.openTrip).toHaveBeenCalledWith(id)); expect(f.client.officialImport.mock.calls[1]).toEqual(attempted);
    expect(document.querySelector("dialog")).toBeNull(); f.click("しおりを見る"); await vi.waitFor(() => expect(document.querySelector("dialog")).not.toBeNull());
    f.switchAccount(); expect(document.querySelector("dialog")).toBeNull();
  });
});
