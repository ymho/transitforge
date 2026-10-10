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
  const dialog = element("dialog", "trip-sharing-panel trip-sharing-panel--compact"); dialog.setAttribute("aria-label", "旅程の共有");
  const status = element("p", "trip-sharing-status"); status.setAttribute("role", "status");
  const warning = element("p", "", "共有するのは旅程だけです。会話履歴・予約番号・通知配信情報は共有しません。リンクは信頼できる相手だけに渡してください。");
  const management = element("section"), members = element("ul");
  const memberSection = element("section"), grantSection = element("section");
  memberSection.append(element("h4", "", "参加者"), members);
  memberSection.hidden = grantSection.hidden = true;
  const role = element("select"); role.setAttribute("aria-label", "共有する権限"); role.append(option("閲覧", "viewer"), option("編集", "editor"));
  const expiry = element("input"); expiry.type = "datetime-local"; expiry.setAttribute("aria-label", "有効期限"); expiry.required = true;
  const link = element("input"); link.readOnly = true; link.setAttribute("aria-label", "作成した共有リンク"); link.placeholder = "作成したリンク";
  const grants = element("ul"); grantSection.replaceChildren(element("h4", "", "発行したリンク"), grants); let pending = options.initialLink, generation = 0, busy = false;
  const clearLink = () => { link.value = ""; copy.disabled = true; };
  const close = () => { ++generation; pending = undefined; clearLink(); input.value = ""; expiry.value = ""; updateExpiry(); dialog.close(); };
  async function action(work: () => Promise<void>, announce = true) {
    if (busy) return; busy = true; const epoch = generation; setLoadingStatus(status, "処理しています。", true);
    try { await work(); if (epoch === generation) status.textContent = announce ? "更新しました。" : ""; }
    catch { if (epoch === generation) status.textContent = "共有操作を完了できません。認証・権限・期限・接続を確認し、再読み込みしてください。"; }
    finally { busy = false; if (epoch === generation) status.setAttribute("aria-busy", "false"); }
  }
  async function manage(after?: string) {
    const current = options.current(); if (current?.role !== "owner") return;
    const epoch = generation, page = await options.client.manage(current.tripId, after);
    if (epoch !== generation || options.current()?.tripId !== current.tripId) return;
    members.replaceChildren(); grants.replaceChildren();
    for (const p of page.participants) {
      const li = element("li", "", `参加者 ${p.id} · ${roleLabelText(p.role)} · ${p.active ? "有効" : "失効"}`);
      const r = element("select"); r.setAttribute("aria-label", `参加者 ${p.id} の権限`); r.append(option("閲覧", "viewer"), option("編集", "editor")); r.value = p.role;
      li.append(r, control("権限を変更", () => { void action(async () => { await options.client.participant(current.tripId, p, r.value as SharedTripRole, p.active); await manage(after); }); }),
        control(p.active ? "参加を失効" : "参加を再有効化", () => { void action(async () => { await options.client.participant(current.tripId, p, p.role, !p.active); await manage(after); }); }));
      members.append(li);
    }
    for (const g of page.grants) {
      const li = element("li", "", `${roleLabelText(g.role)} · 期限 ${formatExpiry(g.expiresAt)} · ${g.revokedAt ? "失効済み" : "発行済み"}`);
      if (!g.revokedAt) li.append(control("リンクと由来アクセスを失効", () => { void action(async () => { await options.client.revoke(current.tripId, g); clearLink(); await manage(after); }); }));
      grants.append(li);
    }
    memberSection.hidden = page.participants.length === 0;
    grantSection.hidden = page.grants.length === 0 && !page.after;
    if (page.after) grants.append(control("次の共有情報", () => { void action(() => manage(page.after)); }));
  }
  const copy = control("コピー", () => {
    if (!link.value || busy) return;
    const value = link.value, epoch = generation;
    void dialog.ownerDocument.defaultView?.navigator.clipboard?.writeText(value).then(() => {
      if (epoch === generation && link.value === value) status.textContent = "コピーしました。";
    }).catch(() => { if (epoch === generation) { link.focus(); link.select(); status.textContent = "コピーできませんでした。リンクを選択してコピーしてください。"; } });
    if (!dialog.ownerDocument.defaultView?.navigator.clipboard) { link.focus(); link.select(); status.textContent = "リンクを選択してコピーしてください。"; }
  });
  copy.disabled = true;
  const expiryField = element("div", "trip-sharing-expiry trip-sharing-expiry--empty"), expiryPrompt = element("span", "", "期限を指定");
  expiryPrompt.setAttribute("aria-hidden", "true"); expiryField.append(expiry, expiryPrompt);
  const updateExpiry = () => { expiryField.classList.toggle("trip-sharing-expiry--empty", !expiry.value); };
  expiry.addEventListener("input", updateExpiry); expiry.addEventListener("change", updateExpiry);
  const create = control("リンク作成", () => {
    const now = Date.now(), expires = new Date(expiry.value).getTime();
    if (!expiry.value || !Number.isFinite(expires) || expires <= now || expires > now + 90 * 86400000) {
      status.textContent = "有効期限を現在より後、90日以内で指定してください。"; expiry.focus(); return;
    }
    void action(async () => {
      const current = options.current(); if (current?.role !== "owner") throw new Error("Owner required");
      const epoch = generation, value = await options.client.create(current.tripId, role.value as SharedTripRole, new Date(expires).toISOString());
      if (epoch !== generation || options.current()?.tripId !== current.tripId) return;
      link.value = options.makeLink({ tripId: current.tripId, grantId: value.grant.id, secret: value.secret }); copy.disabled = false; await manage();
    });
  });
  create.classList.add("ds-button--primary");
  const fields = element("div", "trip-sharing-fields");
  const roleLabel = element("label", "", "権限"), expiryLabel = element("label", "", "有効期限（必須）");
  roleLabel.append(role); expiryLabel.append(expiryField); fields.append(roleLabel, expiryLabel);
  const linkRow = element("div", "trip-sharing-link-row"); linkRow.append(create, link, copy);
  management.append(element("h3", "", "共有リンクを発行"), fields, linkRow, memberSection, grantSection);
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
  const input = element("input"); input.type = "password"; input.autocomplete = "off"; input.placeholder = "共有リンクを貼り付け"; input.setAttribute("aria-label", "共有リンクを貼り付け");
  const redeem = control("共有リンクで参加して開く", () => { void action(async () => {
    const value = pending ?? options.parseLink(input.value); input.value = ""; if (!value) throw new Error("Invalid link");
    const epoch = generation;
    if (options.authenticated && !options.authenticated()) { if (!options.login) throw new Error("Authentication required"); await options.login(value); return; }
    const result = await options.client.redeem(value); pending = undefined;
    if (epoch !== generation) return; await options.navigate(result.tripId); close();
  }); });
  const refresh = () => action(async () => { const epoch = generation; const current = options.current(); management.hidden = Boolean(pending) || current?.role !== "owner"; if (!management.hidden) await manage();
    officialActions.hidden = true; if (!pending && options.official && current?.role === "owner" && current.trip && await options.official.officialCapabilities() && epoch === generation && options.current()?.tripId === current.tripId) officialActions.hidden = false; }, false);
  const header = element("header", "trip-sharing-header"), closeButton = control("×", close);
  closeButton.classList.add("trip-sharing-close"); closeButton.setAttribute("aria-label", "閉じる");
  const heading = element("h2", "", "旅程の共有"); header.append(heading, closeButton);
  const join = element("details", "trip-sharing-join");
  join.open = true; join.hidden = !pending;
  join.append(element("summary", "", "共有リンクで参加"), input, redeem);
  const footer = element("footer", "trip-sharing-footer");
  footer.append(status, control("再読み込み", () => { void refresh(); }));
  dialog.append(header, warning, management, join, officialActions, footer);
  options.root.append(dialog);
  const open = () => { ++generation; clearLink(); updateExpiry(); join.hidden = !pending;
    heading.textContent = pending ? "共有リンクで参加" : "旅程の共有"; dialog.setAttribute("aria-label", heading.textContent);
    if (!dialog.open) dialog.showModal(); management.hidden = Boolean(pending) || options.current()?.role !== "owner"; officialActions.hidden = true;
    if (options.authenticated && !options.authenticated()) status.textContent = "共有リンクで参加して開くと、ログイン後にこの旅程へ移動します。"; else void refresh(); };
  options.button.addEventListener("click", open); dialog.addEventListener("cancel", close);
  if (pending) { if (options.resumeJoin) { ++generation; dialog.showModal(); redeem.click(); } else open(); }
  return { dialog, open, destroy() { close(); options.button.removeEventListener("click", open); dialog.remove(); } };
}

function roleLabelText(role: TripRole): string { return role === "editor" ? "編集" : role === "viewer" ? "閲覧" : "所有者"; }
function formatExpiry(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
}
