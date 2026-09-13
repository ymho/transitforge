import type { ConversationSessionRepository } from "../concierge/conversation-session-repository";
import { migrateTripToServer, type TripMigrationOutcome } from "./trip-server-migration";
import { createServerTripWorkspaceSource } from "./server-trip-workspace-source";
import type { TripWorkspaceController } from "./trip-workspace-controller";

/** Future consent/auth host seam. Intentionally not installed as a public import button before #389.
 * The pending source freezes legacy writers, including on partial failures. Original bytes survive.
 */
export async function migrateTripWorkspace(options: Parameters<typeof migrateTripToServer>[0],
  workspace: TripWorkspaceController, conversations: ConversationSessionRepository): Promise<TripMigrationOutcome> {
  if (!options.authenticatedScope?.trim()) return { state: "legacy-only", error: "authentication-required" };
  workspace.attach(options.sessionId, { sourceState: "migration-pending", getLoadState: () => "loading", getCurrentTrip: () => undefined });
  const result = await migrateTripToServer(options);
  if (result.state === "server-v2" && result.tripId) {
    const session = conversations.list().find((s) => s.id === options.sessionId);
    // No resurrection if conversation was removed during upload; the independent Trip still exists.
    if (session) {
      try { conversations.save({ ...session, tripSourceState: "server-v2", tripId: result.tripId }); }
      catch {
        workspace.attach(options.sessionId, { sourceState: "server-v2", getLoadState: () => "unavailable", getCurrentTrip: () => undefined });
        return { ...result, error: "unavailable" }; // Successful marker repairs the local reference on retry.
      }
    }
    const source = createServerTripWorkspaceSource(result.tripId, options.client);
    workspace.attach(options.sessionId, source); await source.refresh();
  } else {
    workspace.attach(options.sessionId, { sourceState: "migration-pending", getLoadState: () => "unavailable", getCurrentTrip: () => undefined,
      retry: async () => { await migrateTripWorkspace(options, workspace, conversations); } });
  }
  return result;
}
