import { describe, expect, it, vi } from "vitest";
import { consumeTripShareLink, makeTripShareLink, parseTripShareLink } from "./trip-share-link";
const link = { tripId: "11111111-1111-4111-8111-111111111111", grantId: "22222222-2222-4222-8222-222222222222", secret: "s".repeat(43) };
describe("ephemeral share link", () => {
  it("uses a fragment, strips query parameters, and consumes without retaining the URL secret", () => {
    const href = makeTripShareLink("https://example.test/?old=query", link), replaceState = vi.fn();
    expect(new URL(href).search).toBe(""); expect(parseTripShareLink(href)).toEqual(link);
    expect(consumeTripShareLink({ href }, { replaceState })).toEqual(link);
    expect(replaceState.mock.calls[0]?.[2]).toBe("https://example.test/");
    expect(JSON.stringify(replaceState.mock.calls)).not.toContain(link.secret);
  });
  it("rejects ID-only, malformed links and extra fields; scrubs invalid secret fragments too", () => {
    for (const suffix of ["", "bad", `${link.tripId}.${link.grantId}`, `${link.tripId}.${link.grantId}.${link.secret}.extra`]) {
      const href = `https://example.test/#trip-share=${suffix}`, replaceState = vi.fn();
      expect(consumeTripShareLink({ href }, { replaceState })).toBeUndefined(); expect(replaceState).toHaveBeenCalledOnce();
    }
  });
});
