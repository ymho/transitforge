import { describe, expect, it } from "vitest";

import { RequestError } from "../contracts/agent-request.js";
import { createAccommodationSearchOperation, providerSearchFrom } from "./accommodation-search.js";

describe("providerSearchFrom", () => {
  it("境界内の宿泊検索を正規化する", () => {
    expect(providerSearchFrom({ destination: " 出雲市 ", checkInDate: "2026-08-16", checkOutDate: "2026-08-18", adults: 2, limit: 3 })).toEqual({ destination: "出雲市", checkInDate: "2026-08-16", checkOutDate: "2026-08-18", adults: 2, limit: 3 });
  });

  it.each([
    { destination: "出雲市", checkInDate: "2026-08-18", checkOutDate: "2026-08-16" },
    { destination: "出雲市", checkInDate: "2026-08-16", checkOutDate: "2026-09-18" },
    { destination: "出雲市", checkInDate: "2026-08-16", checkOutDate: "2026-08-17", adults: 0 },
    { destination: "出雲市", checkInDate: "2026-08-16", checkOutDate: "2026-08-17", limit: 6 },
  ])("不正な検索条件を拒否する", (value) => expect(() => providerSearchFrom(value)).toThrow(RequestError));

  it("Provider結果だけを返す", async () => {
    const operation = createAccommodationSearchOperation({ async search(request, requestId) { return [{ kind: "accommodation", provider: "travel-provider", providerItemId: request.destination, name: requestId ?? "", checkInDate: request.checkInDate, checkOutDate: request.checkOutDate }]; } });
    await expect(operation({ destination: "出雲市", checkInDate: "2026-08-16", checkOutDate: "2026-08-17" }, { requestId: "request-1" })).resolves.toEqual({ body: { accommodations: [{ kind: "accommodation", provider: "travel-provider", providerItemId: "出雲市", name: "request-1", checkInDate: "2026-08-16", checkOutDate: "2026-08-17" }] } });
  });
});
