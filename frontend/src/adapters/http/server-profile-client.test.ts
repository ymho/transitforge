import { describe, expect, it, vi } from "vitest";
import { HttpServerProfileClient } from "./server-profile-client";
import type { UserProfile } from "@raiquora/trip/travel-profile";
const profile: UserProfile = { version: 2, home: {}, companions: { usual: ["solo"], children: [] }, travelStyle: { pace: 0.1 }, preferences: {}, transport: { maxTypicalTravelMinutes: null }, notes: {}, aiNoteFields: [], updatedAt: "2026-09-18T00:00:00.000Z" };
describe("Profile HTTP client", () => {
  it("uses a null profile for normal absence and sends no principal", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ version: "profile-api-v1", profile: null }))).mockResolvedValueOnce(new Response(JSON.stringify({ version: "profile-api-v1", profile, revision: 0 })));
    const client = new HttpServerProfileClient("/api/profile/v1", request);
    expect(await client.get()).toBeUndefined(); expect(await client.update(profile, null)).toEqual({ profile, revision: 0 });
    expect(JSON.parse(request.mock.calls[1]![1]!.body as string)).toEqual({ version: "profile-api-v1", operation: "update", profile, expectedRevision: null });
  });
});
