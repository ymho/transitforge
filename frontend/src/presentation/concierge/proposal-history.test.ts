// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { configureAiGuidePanel } from "./ai-guide-panel";
import { createTrip, applyTripProposal } from "@raiquora/trip/trip";

it("restored proposal needs an explicit review and cannot preview a different Trip or revision", () => {
  const trip = createTrip("11111111-1111-4111-8111-111111111111", "旅行", "2026-09-01T00:00:00Z");
  const proposal = { tripId: trip.id, baseRevision: 0, summary: "条件案", patches: [{ type: "request" as const, request: { constraints: [], assumptions: [], goal: "散策" } }] };
  document.body.innerHTML = '<section><ol></ol><form><input><button></button></form></section>';
  const messages = document.querySelector('ol')!, onTripUpdateProposal = vi.fn();
  const button = () => document.createElement('button'), select = () => document.createElement('select');
  const controller = configureAiGuidePanel({ conversationSessionId: 'a', panel: document.querySelector('section')!, toggle: button(), close: button(), messages,
    form: document.querySelector('form')!, input: document.querySelector('input')!, submit: document.querySelector('button')!, suggestions: [], contextChoices: document.createElement('div'),
    settingsToggle: button(), settingsPanel: document.createElement('div'), transferPace: select(), rankingPreference: select(), storage: localStorage,
    historyRepository: { list: () => [{ messageId: 'm', role: 'assistant', response: { text: '提案', tripUpdateProposal: proposal } }], append: vi.fn(), delete: vi.fn() }, onTripUpdateProposal,
  }, vi.fn());
  controller.switchSession('a');
  expect(onTripUpdateProposal).not.toHaveBeenCalled();
  const review = [...messages.querySelectorAll('button')].find(b => b.textContent === '条件の変更案を確認')!;
  expect(review).toBeDefined(); review.click(); expect(onTripUpdateProposal).toHaveBeenCalledWith(proposal);
  expect(() => applyTripProposal({ ...trip, revision: 1 }, proposal)).toThrow();
  expect(() => applyTripProposal({ ...trip, id: "22222222-2222-4222-8222-222222222222" }, proposal)).toThrow();
});
it("restores a consultation proposal as an explicit review action without auto-adoption", () => {
  const request = { constraints: [], assumptions: [] }, proposal = { conversationId: "11111111-1111-4111-8111-111111111111", baseRequest: request, request: { ...request, goal: "美術館" }, summary: "目的の案" };
  document.body.innerHTML = '<section><ol></ol><form><input><button></button></form></section>';
  const messages = document.querySelector('ol')!, onConsultationRequestProposal = vi.fn(), onTripUpdateProposal = vi.fn();
  const button = () => document.createElement('button'), select = () => document.createElement('select');
  const controller = configureAiGuidePanel({ conversationSessionId: proposal.conversationId, panel: document.querySelector('section')!, toggle: button(), close: button(), messages,
    form: document.querySelector('form')!, input: document.querySelector('input')!, submit: document.querySelector('button')!, suggestions: [], contextChoices: document.createElement('div'),
    settingsToggle: button(), settingsPanel: document.createElement('div'), transferPace: select(), rankingPreference: select(), storage: localStorage,
    historyRepository: { list: () => [{ messageId: 'm', role: 'assistant', response: { text: '提案', consultationRequestProposal: proposal } }], append: vi.fn(), delete: vi.fn() }, onConsultationRequestProposal, onTripUpdateProposal,
  }, vi.fn());
  controller.switchSession(proposal.conversationId);
  expect(onConsultationRequestProposal).not.toHaveBeenCalled();
  [...messages.querySelectorAll('button')].find(b => b.textContent === '条件の変更案を確認')!.click();
  expect(onConsultationRequestProposal).toHaveBeenCalledWith(proposal); expect(onTripUpdateProposal).not.toHaveBeenCalled();
});
