import { expect, it } from "vitest";
import { parseConsultationRequest } from "./consultation-request";
it("keeps the same typed request while rejecting adopted-item references and oversized drafts", () => {
  const request = { goal: "温泉", constraints: [], assumptions: [] };
  expect(parseConsultationRequest(request)).toEqual(request); expect(parseConsultationRequest(request)).not.toBe(request);
  expect(() => parseConsultationRequest({ ...request, goal: "温".repeat(6000) })).toThrow();
  expect(() => parseConsultationRequest({ ...request, constraints: [{ id: "c", source: "user", strength: "hard", scope: { type: "item", itemId: "i" }, requirement: { type: "pace", value: 0.3 } }] })).toThrow();
  expect(() => parseConsultationRequest({ ...request, tripId: "invented" })).toThrow();
});
