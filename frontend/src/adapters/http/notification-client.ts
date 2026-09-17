import { validateNotificationView, type NotificationView } from "@raiquora/trip/notification";
import type { NotificationClient } from "../../usecases/notifications/notification-client";

export class HttpNotificationClient implements NotificationClient {
  constructor(private readonly endpoint = "/api/trips/notifications/v1", private readonly request: typeof fetch = fetch) {}
  private async execute(command: Record<string, unknown>) {
    const response = await this.request(this.endpoint, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: "notification-api-v1", ...command }), signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error("通知を取得できません。認証・公開設定と接続を確認してください。");
    const v = await response.json();
    if (!v || typeof v !== "object" || v.version !== "notification-api-v1") throw new Error("通知の形式を確認できません。");
    return v;
  }
  async list(after?: string) {
    const v = await this.execute({ operation: "list", ...(after ? { after } : {}) });
    if (Object.keys(v).some((k) => !["version", "notifications", "after"].includes(k)) || !Array.isArray(v.notifications) || v.notifications.length > 20 ||
        v.after !== undefined && (typeof v.after !== "string" || !/^[a-f0-9]{64}$/.test(v.after))) throw new Error("通知の形式を確認できません。");
    v.notifications.forEach(validateNotificationView);
    return { notifications: v.notifications as NotificationView[], ...(v.after ? { after: v.after as string } : {}) };
  }
  async read(id: string, version: number) {
    const v = await this.execute({ operation: "read", id, revision: version }); if (v.ok !== true) throw new Error("既読を保存できません。");
  }
}
