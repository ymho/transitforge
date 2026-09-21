import { expect, it } from "vitest";
import { parsePublicRequestProposal } from "./public-request-proposal";
const proposal = { tripId: "11111111-1111-4111-8111-111111111111", baseRevision: 2, summary: "条件案", patches: [{ type: "request", request: { constraints: [], assumptions: [] } }] };
it("accepts a bounded detached request proposal", () => {
  const parsed = parsePublicRequestProposal(proposal);
  expect(parsed).toEqual(proposal); expect(parsed).not.toBe(proposal);
});
it.each([
  { ...proposal, trace: "private" }, { ...proposal, baseRevision: -1 }, { ...proposal, tripId: "foreign" },
  { ...proposal, patches: [{ type: "title", title: "wrong" }] },
  { ...proposal, patches: [{ type: "request", request: { constraints: [], assumptions: [], token: "secret" } }] },
  { ...proposal, patches: [{ type: "request", request: { constraints: [], assumptions: [], goal: "大".repeat(6000) } }] },
])("rejects malformed, non-request or oversized public data", value => {
  expect(() => parsePublicRequestProposal(value)).toThrow();
});
