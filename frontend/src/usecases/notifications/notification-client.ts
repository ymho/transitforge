import type { NotificationView } from "@raiquora/trip/notification";
export interface NotificationClient {
  list(after?: string): Promise<{ notifications: NotificationView[]; after?: string }>;
  read(id: string, version: number): Promise<void>;
}
