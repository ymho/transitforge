// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { configureTripSharing } from "./trip-sharing-panel";
import { makeTripShareLink, parseTripShareLink } from "../../adapters/browser/trip-share-link";
import type { TripRole } from "@raiquora/trip/trip-sharing";
const id = "11111111-1111-4111-8111-111111111111", grantId = "22222222-2222-4222-8222-222222222222";
const grant = { id: grantId, tripId: id, version: 0, role: "viewer" as const, createdAt: "2026-09-18T00:00:00.000Z", expiresAt: "2026-09-25T00:00:00.000Z" };
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });
async function setup(role: TripRole = "owner") {
  const client = { create: vi.fn(async () => ({ grant, secret: "s".repeat(43) })), redeem: vi.fn(async () => ({ tripId: id, role: "viewer" as const })),
    revoke: vi.fn(async () => {}), participant: vi.fn(async () => {}), accessible: vi.fn(async () => ({ trips: [] })),
    manage: vi.fn(async () => ({ participants: [{ id: grantId, tripId: id, version: 0, role: "viewer" as const, active: true, joinedAt: grant.createdAt, updatedAt: grant.createdAt }], grants: [grant] })) };
  const button = document.createElement("button"), navigate = vi.fn(async () => {});
  const ui = configureTripSharing({ root: document.body, button, client, current: () => ({ tripId: id, role }), navigate,
    parseLink: parseTripShareLink, makeLink: (link) => makeTripShareLink("https://example.test/", link) });
  ui.dialog.showModal = () => ui.dialog.setAttribute("open", ""); ui.dialog.close = () => ui.dialog.removeAttribute("open");
  ui.open();
  await vi.waitFor(() => expect(client.manage).toHaveBeenCalledTimes(role === "owner" ? 1 : 0));
  await vi.waitFor(() => expect(ui.dialog.querySelector('[role="status"]')!.getAttribute("aria-busy")).toBe("false"));
  const click = (text: string) => [...ui.dialog.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? b.textContent) === text)!.click();
  return { client, ui, click, navigate };
}
describe("share management UI", () => {
  it("owner can choose editor/expiry, create/revoke and manage participants; secret cleared on close", async () => {
    const f = await setup();
    f.ui.dialog.querySelector<HTMLSelectElement>('[aria-label="共有する権限"]')!.value = "editor";
    f.ui.dialog.querySelector<HTMLInputElement>('input[type="datetime-local"]')!.value = new Date(Date.now() + 86400000).toISOString().slice(0, 16);
    f.click("リンク作成"); await vi.waitFor(() => expect(f.client.create).toHaveBeenCalledWith(id, "editor", expect.any(String)));
    await vi.waitFor(() => expect(f.ui.dialog.querySelector<HTMLInputElement>("input[readonly]")!.value).toContain("#trip-share="));
    await vi.waitFor(() => expect(f.ui.dialog.textContent).toContain("更新しました"));
    f.click("リンクと由来アクセスを失効"); await vi.waitFor(() => expect(f.client.revoke).toHaveBeenCalledWith(id, grant));
    await vi.waitFor(() => expect(f.ui.dialog.textContent).toContain("更新しました"));
    f.click("権限を変更"); await vi.waitFor(() => expect(f.client.participant).toHaveBeenCalled());
    f.click("閉じる"); expect(f.ui.dialog.querySelector<HTMLInputElement>("input[readonly]")!.value).toBe("");
  });
  it("normal sharing stays scoped to the current trip and hides join controls for viewers too", async () => {
    const f = await setup("viewer"); expect(f.client.manage).not.toHaveBeenCalled(); expect(f.client.accessible).not.toHaveBeenCalled();
    expect(f.ui.dialog.querySelector("section")!.hidden).toBe(true);
    expect(f.ui.dialog.querySelector<HTMLElement>(".trip-sharing-join")!.hidden).toBe(true);
    expect(f.ui.dialog.textContent).not.toContain("参加している旅程");
  });
  it("requires a future explicit expiry and copies only the newly created URL", async () => {
    const f = await setup(), expiry = f.ui.dialog.querySelector<HTMLInputElement>('input[type="datetime-local"]')!;
    expect(expiry.required).toBe(true); f.click("リンク作成"); expect(f.client.create).not.toHaveBeenCalled();
    expect(f.ui.dialog.textContent).toContain("有効期限を");
    expiry.value = new Date(Date.now() - 86400000).toISOString().slice(0, 16); f.click("リンク作成"); expect(f.client.create).not.toHaveBeenCalled();
    expiry.value = new Date(Date.now() + 91 * 86400000).toISOString().slice(0, 16); f.click("リンク作成"); expect(f.client.create).not.toHaveBeenCalled();
    const copy = [...f.ui.dialog.querySelectorAll("button")].find(b => b.textContent === "コピー")!;
    expect(copy.disabled).toBe(true);
    const writeText = vi.fn(async () => {}); Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: { writeText } });
    expiry.value = new Date(Date.now() + 86400000).toISOString().slice(0, 16); expiry.dispatchEvent(new Event("input"));
    f.click("リンク作成"); await vi.waitFor(() => expect(copy.disabled).toBe(false));
    await vi.waitFor(() => expect(f.ui.dialog.querySelector('[role="status"]')!.getAttribute("aria-busy")).toBe("false"));
    const link = f.ui.dialog.querySelector<HTMLInputElement>("input[readonly]")!; f.click("コピー");
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(link.value));
    await vi.waitFor(() => expect(f.ui.dialog.textContent).toContain("コピーしました"));
    expect(copy.parentElement).toBe(link.parentElement); f.click("閉じる"); expect(copy.disabled).toBe(true); expect(link.value).toBe("");
  });
  it("formats issued roles and timestamps for people instead of exposing enum and ISO values", async () => {
    const f = await setup();
    expect(f.ui.dialog.textContent).not.toContain("viewer"); expect(f.ui.dialog.textContent).not.toContain("editor");
    expect(f.ui.dialog.textContent).not.toContain(grant.expiresAt); expect(f.ui.dialog.textContent).toContain("閲覧 · 期限 2026/09/25");
    expect(f.ui.dialog.textContent).not.toContain("未指定は7日"); expect(f.client.accessible).not.toHaveBeenCalled();
  });
});
it("explicit Join hands off to login and resumed login redeems then opens the Trip once", async () => {
  const f = await setup(); f.ui.destroy(); const link = { tripId: id, grantId, secret: "s".repeat(43) }, login = vi.fn(async () => {});
  const base = { root: document.body, button: document.createElement("button"), client: f.client, current: () => undefined,
    navigate: f.navigate, parseLink: parseTripShareLink, makeLink: (v: typeof link) => makeTripShareLink("https://example.test/", v), initialLink: link };
  const signedOut = configureTripSharing({ ...base, authenticated: () => false, login });
  [...signedOut.dialog.querySelectorAll("button")].find(b => b.textContent === "共有リンクで参加して開く")!.click();
  await vi.waitFor(() => expect(login).toHaveBeenCalledWith(link)); expect(f.client.redeem).not.toHaveBeenCalled(); signedOut.destroy();
  const resumed = configureTripSharing({ ...base, authenticated: () => true, resumeJoin: true });
  await vi.waitFor(() => expect(f.navigate).toHaveBeenCalledWith(id)); expect(f.client.redeem).toHaveBeenCalledTimes(1);
  expect(resumed.dialog.open).toBe(false); resumed.destroy();
});

it("hides empty sections and keeps refresh silent with close in the header", async () => {
  const f = await setup();
  f.client.manage.mockResolvedValue({ participants: [], grants: [] });
  f.click("再読み込み");
  await vi.waitFor(() => expect(f.client.manage).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(f.ui.dialog.querySelector('[role="status"]')!.textContent).toBe(""));
  for (const title of ["参加者", "発行したリンク"]) {
    const heading = [...f.ui.dialog.querySelectorAll("h3, h4")].find(h => h.textContent === title)!;
    expect((heading.parentElement as HTMLElement).hidden).toBe(true);
  }
  expect(f.ui.dialog.querySelector('header button[aria-label="閉じる"]')).not.toBeNull();
  expect(f.ui.dialog.querySelector<HTMLElement>(".trip-sharing-join")!.hidden).toBe(true);
});
