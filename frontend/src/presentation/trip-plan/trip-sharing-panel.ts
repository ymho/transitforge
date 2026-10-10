import type { Trip } from "@raiquora/trip/trip";
import type { TripLibraryClient } from "../../usecases/trip-plan/trip-library-client";
import { setLoadingStatus } from "../shared/primitives";
import type { TripSharingClient, TripShareLink } from "../../usecases/trip-plan/trip-sharing-client";
import type { TripRole, SharedTripRole } from "@raiquora/trip/trip-sharing";
import { element, control, option } from "./trip-workspace-elements";

/** Secrets stay in this dialog; an explicit login handoff is owned by the browser adapter. */
export function configureTripSharing(options: { root: HTMLElement; button: HTMLElement; client: TripSharingClient;
  official?: TripLibraryClient; authenticated?(): boolean; login?(link: TripShareLink): Promise<void>; resumeJoin?: boolean;
  current(): { tripId: string; role?: TripRole; trip?: Trip } | undefined; navigate(tripId: string): Promise<void>;
  parseLink(text: string): TripShareLink | undefined; makeLink(link: TripShareLink): string; initialLink?: TripShareLink }) {
  const dialog = element("dialog", "trip-sharing-panel"); dialog.setAttribute("aria-label", "旅程の共有");
  const status = element("p"); status.setAttribute("role", "status");
  const warning = element("p", "", "共有するのは旅程だけです。会話履歴・予約番号・通知配信情報は共有しません。リンクは信頼できる相手だけに渡してください。");
  const management = element("section"), list = element("ul"), members = element("ul");
  const role = element("select"); role.setAttribute("aria-label", "共有する権限"); role.append(option("閲覧のみ", "viewer"), option("編集可能", "editor"));
  const expiry = element("input"); expiry.type = "datetime-local"; expiry.setAttribute("aria-label", "有効期限（省略時7日、最大90日）");
  const link = element("input"); link.readOnly = true; link.setAttribute("aria-label", "作成した共有リンク"); link.hidden = true;
  const grants = element("ul"); let pending = options.initialLink, generation = 0, busy = false;
  const close = () => { ++generation; pending = undefined; link.value = ""; link.hidden = true; input.value = ""; dialog.close(); };
  async function action(work: () => Promise<void>) {
    if (busy) return; busy = true; const epoch = generation; setLoadingStatus(status, "処理しています。", true);
    try { await work(); if (epoch === generation) status.textContent = "更新しました。"; }
    catch { if (epoch === generation) status.textContent = "共有操作を完了できません。認証・権限・期限・接続を確認し、再読み込みしてください。"; }
    finally { busy = false; if (epoch === generation) status.setAttribute("aria-busy", "false"); }
  }
  async function manage(after?: string) {
    const current = options.current(); if (current?.role !== "owner") return;
    const epoch = generation, page = await options.client.manage(current.tripId, after);
    if (epoch !== generation || options.current()?.tripId !== current.tripId) return;
    members.replaceChildren(); grants.replaceChildren();
    for (const p of page.participants) {
      const li = element("li", "", `参加者 ${p.id} · ${p.role} · ${p.active ? "有効" : "失効"}`);
      const r = element("select"); r.setAttribute("aria-label", `参加者 ${p.id} の権限`); r.append(option("閲覧のみ", "viewer"), option("編集可能", "editor")); r.value = p.role;
      li.append(r, control("権限を変更", () => { void action(async () => { await options.client.participant(current.tripId, p, r.value as SharedTripRole, p.active); await manage(after); }); }),
        control(p.active ? "参加を失効" : "参加を再有効化", () => { void action(async () => { await options.client.participant(current.tripId, p, p.role, !p.active); await manage(after); }); }));
      members.append(li);
    }
    for (const g of page.grants) {
      const li = element("li", "", `${g.role} · 期限 ${g.expiresAt} · ${g.revokedAt ? "失効済み" : "発行済み"}`);
      if (!g.revokedAt) li.append(control("リンクと由来アクセスを失効", () => { void action(async () => { await options.client.revoke(current.tripId, g); link.value = ""; link.hidden = true; await manage(after); }); }));
      grants.append(li);
    }
    if (page.after) grants.append(control("次の共有情報", () => { void action(() => manage(page.after)); }));
  }
  const create = control("共有リンクを作成", () => { void action(async () => {
    const current = options.current(); if (current?.role !== "owner") throw new Error("Owner required");
    const epoch = generation, value = await options.client.create(current.tripId, role.value as SharedTripRole, expiry.value ? new Date(expiry.value).toISOString() : undefined);
    if (epoch !== generation || options.current()?.tripId !== current.tripId) return;
    link.value = options.makeLink({ tripId: current.tripId, grantId: value.grant.id, secret: value.secret }); link.hidden = false; link.select(); await manage();
  }); });
  create.classList.add("ds-button--primary");
  management.append(element("h3", "", "この旅程の共有管理"), role, expiry, create, link,
    element("h4", "", "参加者"), members, element("h4", "", "発行したリンク"), grants);
  const officialActions = element("section"); officialActions.hidden = true;
  const publish = control("公式しおりとして公開・更新", () => { const current = options.current(); if (!current?.trip || !options.official) return;
    if (!document.defaultView?.confirm("この旅程を全ユーザー向けに公式公開しますか？日付・人数・列車・宿の選択・予約・価格を除いたモデル旅程を公開します。")) return;
    void action(async () => { await options.official!.officialPublish(current.trip!); });
  });
  const withdraw = control("公式公開を取り下げる", () => { const current = options.current(); if (!current || !options.official) return;
    void action(async () => { const guide = await options.official!.officialGet(current.tripId); await options.official!.officialWithdraw(guide); });
  });
  publish.classList.add("ds-button--primary");
  officialActions.append(element("h3", "", "公式しおり"), publish, withdraw);
  const input = element("input"); input.type = "password"; input.autocomplete = "off"; input.setAttribute("aria-label", "共有リンクを貼り付け");
  const redeem = control("共有リンクで参加して開く", () => { void action(async () => {
    const value = pending ?? options.parseLink(input.value); input.value = ""; if (!value) throw new Error("Invalid link");
    const epoch = generation;
    if (options.authenticated && !options.authenticated()) { if (!options.login) throw new Error("Authentication required"); await options.login(value); return; }
    const result = await options.client.redeem(value); pending = undefined;
    if (epoch !== generation) return; await options.navigate(result.tripId); close();
  }); });
  async function accessible(after?: string) {
    const epoch = generation, page = await options.client.accessible(after); if (epoch !== generation) return;
    list.replaceChildren();
    for (const entry of page.trips) { const li = element("li", "", `${entry.trip.title} · ${entry.role}`);
      li.append(control("共有旅程を開く", () => { void action(async () => { await options.navigate(entry.trip.id); close(); }); })); list.append(li); }
    if (page.afterTripId) list.append(control("次の共有旅程", () => { void action(() => accessible(page.afterTripId)); }));
  }
  const refresh = () => action(async () => { const epoch = generation; const current = options.current(); management.hidden = current?.role !== "owner"; await accessible(); if (!management.hidden) await manage();
    officialActions.hidden = true; if (options.official && current?.role === "owner" && current.trip && await options.official.officialCapabilities() && epoch === generation && options.current()?.tripId === current.tripId) officialActions.hidden = false; });
  dialog.append(element("h2", "", "旅程の共有"), control("閉じる", close), warning, status, input, redeem,
    control("再読み込み", () => { void refresh(); }), management, officialActions, element("h3", "", "参加している旅程"), list);
  options.root.append(dialog);
  const open = () => { ++generation; if (!dialog.open) dialog.showModal(); management.hidden = options.current()?.role !== "owner"; officialActions.hidden = true;
    if (options.authenticated && !options.authenticated()) status.textContent = "共有リンクで参加して開くと、ログイン後にこの旅程へ移動します。"; else void refresh(); };
  options.button.addEventListener("click", open); dialog.addEventListener("cancel", close);
  if (pending) { if (options.resumeJoin) { ++generation; dialog.showModal(); redeem.click(); } else open(); }
  return { dialog, open, destroy() { close(); options.button.removeEventListener("click", open); dialog.remove(); } };
}
