import type { NotificationClient } from "../../usecases/notifications/notification-client";
import { validateNotificationView, type NotificationView } from "@raiquora/trip/notification";

/** Read view only. No local notification store, fake owner, Agent dispatch or permission prompt. */
export function configureNotificationCenter(options: { root: HTMLElement; buttons: HTMLElement[]; client: NotificationClient;
  navigate(tripId: string, itemId?: string): Promise<void> }) {
  const dialog = document.createElement("dialog"); dialog.className = "notification-center"; dialog.setAttribute("aria-label", "通知");
  const heading = document.createElement("h2"); heading.textContent = "通知";
  const status = document.createElement("p"); status.setAttribute("role", "status");
  const note = document.createElement("p"); note.textContent = "通知時点の情報です。未確認・過去の通知は現在の警告ではありません。旅程を開くと最新版を表示します。";
  const list = document.createElement("ol"); let after: string | undefined, generation = 0;
  function button(label: string, action: () => void) { const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.addEventListener("click", action); return b; }
  const close = button("閉じる", () => { ++generation; dialog.close(); });
  const refresh = button("再読み込み", () => { void load(); });
  const more = button("次の通知", () => { void load(after); }); more.hidden = true;
  dialog.append(heading, close, note, status, refresh, list, more); options.root.append(dialog);
  const render = (n: NotificationView) => {
    validateNotificationView(n); const li = document.createElement("li"), label = document.createElement("p"), text = document.createElement("p");
    label.textContent = `${n.status === "read" ? "既読" : "未読"} · ${n.currency === "current" ? "現在の警告" : n.currency === "historical" ? "過去の通知" : "現在の状態は未確認"} · 旅程 revision ${n.tripRevision} · ${n.createdAt}`;
    text.textContent = n.message; li.append(label, text);
    const delivery = document.createElement("small"); delivery.textContent = n.status === "failed" ? "配信に失敗しました" : n.status === "pending" ? "配信待ち" : n.status === "suppressed" ? "現在の警告としての配信は抑止されました" : ""; li.append(delivery);
    if (n.status !== "read") {
      const read = button("既読にする", () => { read.disabled = true; void options.client.read(n.id, n.version).then(() => load()).catch(() => { status.textContent = "既読を保存できません。再読み込みして確認してください。"; read.disabled = false; }); }); li.append(read);
    }
    li.append(button("旅程を開く", () => { void options.navigate(n.tripId, n.itemIds[0]).then(() => { ++generation; dialog.close(); }).catch(() => { status.textContent = "旅程を開けません。認証・参照先の状態を確認してください。"; }); }));
    return li;
  };
  async function load(cursor?: string) {
    const request = ++generation; status.textContent = "通知を読み込んでいます。"; list.replaceChildren(); more.hidden = true;
    try {
      const page = await options.client.list(cursor); if (request !== generation) return;
      page.notifications.forEach(validateNotificationView); list.replaceChildren(...page.notifications.map(render));
      after = page.after; more.hidden = !after; status.textContent = page.notifications.length ? "" : "通知はありません。監視の完了や安全を意味するものではありません。";
    } catch { if (request === generation) status.textContent = "通知を取得できません。認証・通知APIの公開設定と接続を確認してください。"; }
  }
  const open = () => { if (!dialog.open) dialog.showModal(); void load(); };
  options.buttons.forEach((b) => b.addEventListener("click", open)); dialog.addEventListener("cancel", () => { ++generation; });
  return { dialog, open, destroy() { ++generation; options.buttons.forEach((b) => b.removeEventListener("click", open)); dialog.remove(); } };
}
