import { describe, expect, it, vi } from "vitest";
import { createConversationSession } from "../../domain/conversation-session";
import type { ConversationSessionRepository } from "../concierge/conversation-session-repository";
import { createTripWorkspaceController } from "./trip-workspace-controller";
import { migrateTripWorkspace } from "./trip-migration-workspace";
import type { TripMigrationAttempt, TripMigrationMarker } from "./trip-server-migration";
import type { Trip } from "@raiquora/trip/trip";

describe("migration workspace ownership", () => {
  it("freezes legacy during upload and supplies the verified server Trip without a writer", async () => {
    let session = createConversationSession(), attempt: TripMigrationAttempt | undefined, marker: TripMigrationMarker | undefined, server: Trip | undefined;
    const workspace = createTripWorkspaceController(session.id);
    const conversations = { list: () => [session], save: vi.fn((next) => { session = next; return next; }) } as unknown as ConversationSessionRepository;
    const legacy = { version: 1 as const, id: "old", title: "移行", destination: "京都", updatedAt: "2026-09-01", items: [] };
    const options = { sessionId: session.id, authenticatedScope: "a", newIdentity: () => ({ tripId: "11111111-1111-4111-8111-111111111111", createdAt: "2026-09-13T01:00:00Z" }),
      store: { exclusive: <T>(_scope: string, _session: string, work: () => Promise<T>) => work(), readLegacy: () => ({ plan: legacy, original: JSON.stringify(legacy) }), attempt: () => attempt, retain: (_scope: string, _session: string, value: TripMigrationAttempt) => { attempt = value; }, marker: () => marker, mark: (_scope: string, _session: string, value: TripMigrationMarker) => { marker = value; } },
      client: { get: async () => server, create: async (trip: Trip) => { expect(workspace.blocksLegacy()).toBe(true); expect(workspace.source()?.sourceState).toBe("migration-pending"); server = trip; return trip; }, attach: async () => {}, detach: async () => {} } };
    const result = await migrateTripWorkspace(options, workspace, conversations);
    expect(result.state).toBe("server-v2"); expect(workspace.current()).toEqual(server);
    expect(workspace.canConfirm()).toBe(false); expect(session.tripId).toBe(server!.id);
    expect(session.tripSourceState).toBe("server-v2");
    workspace.propose("仮案", [{ type: "add", item: { id: "free", title: "散策", type: "activity", category: "free-time", schedule: { type: "unscheduled" } } }]);
    expect(server?.items).toEqual([]);
  });
});
