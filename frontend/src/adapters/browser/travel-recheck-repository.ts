import { recheckDedupeKey, type TravelRecheckRequest, type TravelRecheckSnapshot } from "@raiquora/trip/travel-recheck";

const storageKey = "transitforge.travel-rechecks.v1";
export interface StoredRecheck { request: TravelRecheckRequest; previous?: TravelRecheckSnapshot; latest?: TravelRecheckSnapshot; attempts: number }

export class BrowserTravelRecheckRepository {
  constructor(private readonly storage: Pick<Storage, "getItem" | "setItem">) {}
  list(): StoredRecheck[] { return parse(this.storage.getItem(storageKey)); }
  due(now = new Date()): StoredRecheck[] { return this.list().filter((item) => Date.parse(item.request.scheduledAt) <= now.getTime() && Date.parse(item.request.expiresAt) >= now.getTime() && (!item.latest || Date.parse(item.latest.checkedAt) < Date.parse(item.request.scheduledAt))); }
  schedule(request: TravelRecheckRequest): void {
    const key = recheckDedupeKey(request);
    const existing = this.list().filter((item) => recheckDedupeKey(item.request) !== key);
    this.storage.setItem(storageKey, JSON.stringify([...existing, { request, attempts: 0 }]));
  }
  record(id: string, latest: TravelRecheckSnapshot): void {
    this.storage.setItem(storageKey, JSON.stringify(this.list().map((item) => item.request.id === id ? { ...item, previous: item.latest, latest, attempts: item.attempts + 1 } : item)));
  }
}
function parse(raw: string | null): StoredRecheck[] { try { const value: unknown = raw ? JSON.parse(raw) : []; return Array.isArray(value) ? value.filter((item): item is StoredRecheck => typeof item === "object" && item !== null && "request" in item) : []; } catch { return []; } }
