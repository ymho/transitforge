// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { configureTripSharing } from "./trip-sharing-panel";
import { makeTripShareLink, parseTripShareLink } from "../../adapters/browser/trip-share-link";
import type { TripRole } from "@raiquora/trip/trip-sharing";
const id = "11111111-1111-4111-8111-111111111111", grantId = "22222222-2222-4222-8222-222222222222";
const grant = { id: grantId, tripId: id, version: 0, role: "viewer" as const, createdAt: "2026-09-18T00:00:00.000Z", expiresAt: "2026-09-25T00:00:00.000Z" };
afterEach(() => document.body.replaceChildren());
async function setup(role: TripRole = "owner") {
  const client = { create: vi.fn(async () => ({ grant, secret: "s".repeat(43) })), redeem: vi.fn(async () => ({ tripId: id, role: "viewer" as const })),
    revoke: vi.fn(async () => {}), participant: vi.fn(async () => {}), accessible: vi.fn(async () => ({ trips: [] })),
    manage: vi.fn(async () => ({ participants: [{ id: grantId, tripId: id, version: 0, role: "viewer" as const, active: true, joinedAt: grant.createdAt, updatedAt: grant.createdAt }], grants: [grant] })) };
  const button = document.createElement("button"), navigate = vi.fn(async () => {});
  const ui = configureTripSharing({ root: document.body, button, client, current: () => ({ tripId: id, role }), navigate,
    parseLink: parseTripShareLink, makeLink: (link) => makeTripShareLink("https://example.test/", link) });
  ui.dialog.showModal = () => ui.dialog.setAttribute("open", ""); ui.dialog.close = () => ui.dialog.removeAttribute("open");
  ui.open(); await vi.waitFor(() => expect(client.accessible).toHaveBeenCalled());
  await vi.waitFor(() => expect(ui.dialog.textContent).toContain("更新しました"));
  const click = (text: string) => [...ui.dialog.querySelectorAll("button")].find((b) => b.textContent === text)!.click();
  return { client, ui, click, navigate };
}
describe("share management UI", () => {
  it("owner can choose editor/expiry, create/revoke and manage participants; secret cleared on close", async () => {
    const f = await setup();
    f.ui.dialog.querySelector<HTMLSelectElement>('[aria-label="共有する権限"]')!.value = "editor";
    f.ui.dialog.querySelector<HTMLInputElement>('input[type="datetime-local"]')!.value = "2026-09-21T12:00";
    f.click("共有リンクを作成"); await vi.waitFor(() => expect(f.client.create).toHaveBeenCalledWith(id, "editor", expect.any(String)));
    await vi.waitFor(() => expect(f.ui.dialog.querySelector<HTMLInputElement>("input[readonly]")!.value).toContain("#trip-share="));
    await vi.waitFor(() => expect(f.ui.dialog.textContent).toContain("更新しました"));
    f.click("リンクと由来アクセスを失効"); await vi.waitFor(() => expect(f.client.revoke).toHaveBeenCalledWith(id, grant));
    await vi.waitFor(() => expect(f.ui.dialog.textContent).toContain("更新しました"));
    f.click("権限を変更"); await vi.waitFor(() => expect(f.client.participant).toHaveBeenCalled());
    f.click("閉じる"); expect(f.ui.dialog.querySelector<HTMLInputElement>("input[readonly]")!.value).toBe("");
  });
  it("viewer has no management UI; redeem navigates using only opaque Trip ID", async () => {
    const f = await setup("viewer"); expect(f.client.manage).not.toHaveBeenCalled();
    expect(f.ui.dialog.querySelector("section")!.hidden).toBe(true);
    const input = f.ui.dialog.querySelector<HTMLInputElement>('input[type="password"]')!;
    input.value = makeTripShareLink("https://example.test/", { tripId: id, grantId, secret: "s".repeat(43) });
    f.click("共有リンクで参加して開く"); await vi.waitFor(() => expect(f.navigate).toHaveBeenCalledWith(id));
    expect(input.value).toBe(""); expect(f.ui.dialog.open).toBe(false);
  });
});
