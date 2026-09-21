import { expect, it } from "vitest";
import { parseConsultationRequestProposal, reviewConsultationRequestProposal } from "./consultation-request-proposal";
const conversationId = "11111111-1111-4111-8111-111111111111", baseRequest = { constraints: [], assumptions: [], goal: "散策" };
const proposal = { conversationId, baseRequest, request: { ...baseRequest, goal: "美術館" }, summary: "目的の変更案" };
it("reviews only the original conditions of the intended Conversation", () => {
  expect(reviewConsultationRequestProposal(proposal, conversationId, baseRequest)).toEqual(proposal);
  expect(() => reviewConsultationRequestProposal(proposal, "22222222-2222-4222-8222-222222222222", baseRequest)).toThrow();
  expect(() => reviewConsultationRequestProposal(proposal, conversationId, proposal.request)).toThrow();
  expect(() => reviewConsultationRequestProposal(proposal, conversationId, { ...baseRequest, goal: "別の相談" })).toThrow();
});
it("rejects malformed, over-budget and item-scoped payloads, without accepting a Trip or raw Tool envelope", () => {
  for (const value of [null, { ...proposal, tripId: conversationId }, { ...proposal, trace: "private" },
    { ...proposal, conversationId: "not-uuid" }, { ...proposal, summary: "x".repeat(501) },
    { ...proposal, request: { ...baseRequest, goal: "旅".repeat(6000) } },
    { ...proposal, request: { ...baseRequest, constraints: [{ id: "item", scope: { type: "item", itemId: "i" }, strength: "hard", source: "user", requirement: { type: "pace", value: 0.5 } }] } },
  ]) expect(() => parseConsultationRequestProposal(value)).toThrow();
});
