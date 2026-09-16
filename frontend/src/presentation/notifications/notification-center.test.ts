// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { configureNotificationCenter } from "./notification-center";
import type { NotificationView } from "@raiquora/trip/notification";
const n: NotificationView = { id: "a".repeat(64), version: 2, tripId: "11111111-1111-4111-8111-111111111111", tripRevision: 3,
  itemIds: ["rail"], severity: "attention", status: "sent", phase: "warning", createdAt: "2026-09-13T01:00:00Z", message: "乗換余裕が2分になる見込みです", currency: "current" };
afterEach(() => { document.body.replaceChildren(); });
async function setup(values: NotificationView[] = [n]) {
  const client = { list: vi.fn(async () => ({ notifications: values })), read: vi.fn(async () => {}) }, navigate = vi.fn(async () => {});
  const center = configureNotificationCenter({ root: document.body, buttons: [], client, navigate });
  center.dialog.showModal = () => center.dialog.setAttribute("open", ""); center.dialog.close = () => center.dialog.removeAttribute("open");
  expect(client.list).not.toHaveBeenCalled(); center.open(); await vi.waitFor(() => expect(center.dialog.textContent).toContain(n.message)); return { client, navigate, center };
}
describe("Notification Center", () => {
  it("lists unread/read and routes opaque Trip/item IDs without an Agent or local Trip write", async () => {
    const f = await setup(); expect(f.center.dialog.textContent).toContain("未読"); expect(f.center.dialog.textContent).toContain("現在の警告");
    const buttons = [...f.center.dialog.querySelectorAll("button")]; buttons.find((b) => b.textContent === "既読にする")!.click();
    await vi.waitFor(() => expect(f.client.read).toHaveBeenCalledWith(n.id, 2));
    await vi.waitFor(() => expect(f.center.dialog.textContent).toContain("旅程を開く"));
    [...f.center.dialog.querySelectorAll("button")].find((b) => b.textContent === "旅程を開く")!.click();
    await vi.waitFor(() => expect(f.navigate).toHaveBeenCalledWith(n.tripId, "rail"));
  });
  it("historical revisions and unknown observations are not current warnings; no HTML injection", async () => {
    const f = await setup([{ ...n, status: "read", currency: "historical", message: n.message + "<img src=x>" }, { ...n, currency: "unconfirmed" }]);
    expect(f.center.dialog.textContent).toContain("既読 · 過去の通知 · 旅程 revision 3"); expect(f.center.dialog.textContent).toContain("現在の状態は未確認");
    expect(f.center.dialog.querySelector("img")).toBeNull(); expect(f.center.dialog.textContent).not.toContain("現在の警告 ·");
  });
  it("closed/destroyed view ignores late responses; read-only gate failure has no safety claim", async () => {
    const f = await setup(); f.client.list.mockRejectedValueOnce(new Error("private provider")); f.center.open();
    await vi.waitFor(() => expect(f.center.dialog.textContent).toContain("通知を取得できません")); expect(f.center.dialog.textContent).not.toContain("private provider");
    f.center.destroy(); expect(document.querySelector("dialog")).toBeNull();
  });
});
