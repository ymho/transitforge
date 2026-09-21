import { describe, expect, it, vi } from "vitest";
import { createTrip } from "@raiquora/trip/trip";
import { createConversationDraftTrip } from "./create-conversation-draft-trip";

const tripId = "11111111-1111-4111-8111-111111111111", conversationId = "22222222-2222-4222-8222-222222222222", now = "2026-09-19T00:00:00Z";
describe("explicit conversation draft save", () => {
  it("creates before linking and only accepts the server read-back reference", async () => {
    const client = { get: async () => createTrip(tripId, "新しい旅程", now), create: vi.fn(async (trip) => trip), attach: vi.fn(async () => undefined) };
    await expect(createConversationDraftTrip({ conversationId, tripId, now, client, readBack: async () => ({ tripId }) })).resolves.toMatchObject({ id: tripId, items: [], request: { constraints: [], assumptions: [] } });
    expect(client.create).toHaveBeenCalledBefore(client.attach);
  });
  it("keeps the same id for a response-loss retry and never creates a second Trip", async () => {
    const saved = createTrip(tripId, "新しい旅程", now), create = vi.fn().mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce(saved);
    const input = { conversationId, tripId, now, client: { get: async () => saved, create, attach: vi.fn(async () => undefined) }, readBack: async () => ({ tripId }) };
    await expect(createConversationDraftTrip(input)).rejects.toThrow("response lost");
    await expect(createConversationDraftTrip(input)).resolves.toEqual(saved);
    expect(create.mock.calls.map(([value]) => value.id)).toEqual([tripId, tripId]);
  });
  it("does not delete the created Trip when linking fails", async () => {
    const create = vi.fn(async (trip) => trip), attach = vi.fn(async () => { throw new Error("link unavailable"); });
    await expect(createConversationDraftTrip({ conversationId, tripId, now, client: { get: async () => createTrip(tripId, "新しい旅程", now), create, attach }, readBack: async () => undefined })).rejects.toThrow("link unavailable");
    expect(create).toHaveBeenCalledOnce(); expect(attach).toHaveBeenCalledOnce();
  });
});
