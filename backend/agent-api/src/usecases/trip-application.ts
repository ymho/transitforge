import { parseTripCommand, TripResourceError, tripApiVersion } from "../contracts/trip-api.js";
import { requireTripPrincipal, type TripPrincipal, type TripRepository, type TripConversationReferences } from "../ports/trip-repository.js";

export class TripApplication {
  constructor(private readonly trips: TripRepository, private readonly references: TripConversationReferences) {}
  async execute(principal: TripPrincipal | undefined, value: unknown): Promise<Record<string, unknown>> {
    requireTripPrincipal(principal);
    const command = parseTripCommand(value);
    const version = tripApiVersion;
    switch (command.operation) {
      case "create": return { version, trip: await this.trips.create(principal, command.trip) };
      case "replace": return { version, trip: await this.trips.replace(principal, command.trip) };
      case "get": {
        const trip = await this.trips.get(principal, command.tripId);
        if (!trip) throw new TripResourceError("not-found");
        return { version, trip };
      }
      case "list": return { version, ...await this.trips.list(principal, command) };
      case "archive": await this.trips.archive(principal, command.tripId); return { version };
      case "attach":
        if (!await this.trips.get(principal, command.tripId)) throw new TripResourceError("not-found");
        await this.references.attach(principal, command.conversationId, command.tripId);
        return { version, tripId: command.tripId };
      case "detach": await this.references.detach(principal, command.conversationId); return { version };
      case "reference": return { version, tripId: await this.references.reference(principal, command.conversationId) };
    }
  }
}
