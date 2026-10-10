import { officialGuideSnapshot, importOfficialGuide } from "@raiquora/trip/official-guide";
import type { TripRepository } from "../ports/trip-repository.js";
import type { OfficialGuideRepository } from "../ports/official-guide-repository.js";
import { requireTripPrincipal, type TripPrincipal } from "../contracts/trip-principal.js";
import { tripIdentifier, TripResourceError } from "../contracts/trip-api.js";
const version = "trip-sharing-v1";
export class OfficialGuideApplication {
  constructor(private readonly trips: TripRepository, private readonly guides: OfficialGuideRepository, private readonly publishers: readonly string[], private readonly now = () => new Date().toISOString()) {}
  async execute(principal: TripPrincipal, input: unknown): Promise<Record<string, unknown>> {
    requireTripPrincipal(principal);
    const c = input as Record<string, unknown>;
    const fields: Record<string, string[]> = { "official-capabilities": [], "official-list": ["afterTripId"], "official-get": ["tripId"],
      "official-publish": ["tripId", "baseRevision"], "official-withdraw": ["tripId", "guideVersion"], "official-import": ["tripId", "guideVersion", "newTripId", "startDate", "adults", "children"] };
    const allowed = typeof c?.operation === "string" && Object.hasOwn(fields, c.operation) ? fields[c.operation] : undefined;
    if (!allowed || c.version !== version || Object.keys(c).some(k => !["version", "operation", ...allowed].includes(k))) throw new TripResourceError("invalid-input");
    const publisher = this.publishers.includes(principal.subject);
    if (c.operation === "official-capabilities") return { version, publisher };
    if (c.operation === "official-list") { if (c.afterTripId !== undefined) tripIdentifier(c.afterTripId); const page = await this.guides.list(c.afterTripId as string | undefined);
      const records = await Promise.all(page.guides.map(guide => this.guides.get(guide.id)));
      return { version, guides: records.filter(r => r?.active && this.publishers.includes(r.publisher)).map(r => r!.guide), ...(page.after ? { after: page.after } : {}) }; }
    tripIdentifier(c.tripId);
    const id = c.tripId as string, old = await this.guides.get(id);
    if (c.operation === "official-publish") {
      if (!publisher) throw new TripResourceError("not-found");
      const source = await this.trips.get(principal, id); if (!source) throw new TripResourceError("not-found");
      if (source.revision !== c.baseRevision) throw new TripResourceError("conflict");
      if (!source.items.length) throw new TripResourceError("invalid-input");
      const guide = { id, version: (old?.guide.version ?? 0) + 1, publishedAt: this.now(), trip: officialGuideSnapshot(source) };
      await this.guides.publish(principal, source, { guide, publisher: principal.subject, active: true }, old); return { version, guide };
    }
    if (c.operation === "official-withdraw") {
      if (!publisher || !old || old.publisher !== principal.subject) throw new TripResourceError("not-found");
      if (c.guideVersion !== old.guide.version) throw new TripResourceError("conflict");
      await this.guides.withdraw(principal, old); return { version };
    }
    if (!old?.active || !this.publishers.includes(old.publisher)) throw new TripResourceError("not-found");
    if (c.operation === "official-get") return { version, guide: old.guide };
    if (c.guideVersion !== old.guide.version) throw new TripResourceError("conflict");
    tripIdentifier(c.newTripId);
    let trip;
    try { trip = importOfficialGuide(old.guide, c.newTripId as string, this.now(), c.startDate as string, c.adults as number, c.children as number); }
    catch { throw new TripResourceError("invalid-input"); }
    const requestKey = JSON.stringify([id, old.guide.version, c.startDate, c.adults, c.children]);
    return { version, trip: await this.guides.import(principal, old, trip, requestKey) };
  }
}
