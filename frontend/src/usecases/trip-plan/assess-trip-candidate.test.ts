import { expect, it, vi } from "vitest";
import { candidateAssessmentFixture, assessmentAt } from "../../../../modules/trip/domain/candidate-assessment.fixture";
import { assessTripCandidate } from "./assess-trip-candidate";
import { candidateAssessmentContext } from "@raiquora/agent/candidate-assessment-context";
import { candidateAssessmentView } from "../../presentation/trip-plan/candidate-assessment-view";
import { candidateAssessmentEvidence, candidateAssessmentDescriptor, registerCandidateAssessmentTool } from "../agent/candidate-assessment-tool";
import { AgentToolRegistry } from "@raiquora/agent/tool-registry";
import { validateAgentToolInput } from "@raiquora/agent/agent-tool-input-validator";
import { validateEvidenceAndClaims } from "@raiquora/agent/evidence-model";
import { buildAgentDecisionContext, agentDecisionContextText } from "@raiquora/agent/agent-decision-context";
import { railSelectionFixture } from "../../../../modules/trip/domain/selected-rail-journey.fixture";
import { createTravelCandidate } from "@raiquora/trip/travel-candidate";

it("keeps verified candidate endpoints/date in comparison Evidence without promoting raw route observations", async () => {
  const rail = railSelectionFixture(), f = candidateAssessmentFixture();
  const candidate = createTravelCandidate({ id: rail.candidate.candidateId, journey: rail.candidate.journey });
  const record = { candidate, tripId: f.trip.id, taskId: "task", validUntil: "2026-09-13T08:00:00Z",
    assessmentFacts: { candidateId: candidate.id, rail: { candidate: rail.candidate, inputs: rail.inputs } } };
  const pair = await assessTripCandidate(f.trip, { candidateId: candidate.id, taskId: "task" }, {
    resolve: async () => record, loadTimetables: async () => [],
  }, rail.selectedAt);
  expect(pair.comparison).toEqual({ originStation: "A", destinationStation: "C", serviceDate: "2026-09-13" });
  const evidence = candidateAssessmentEvidence({ ...candidateAssessmentContext(pair), assessmentEvidence: pair.assessment.sources });
  expect(evidence[0]?.facts).toMatchObject({ originStation: "A", destinationStation: "C", serviceDate: "2026-09-13", plannedTravelMinutes: 100 });
  expect(JSON.stringify(evidence)).not.toMatch(/delayMinutes|delayStatus|journey|bookingReference/);
  const invalid = await assessTripCandidate(f.trip, { candidateId: candidate.id, taskId: "task" }, {
    resolve: async () => ({ ...record, assessmentFacts: { ...record.assessmentFacts, rail: { candidate: rail.candidate, inputs: [] } } }), loadTimetables: async () => [],
  }, rail.selectedAt);
  expect(invalid.comparison).toBeUndefined();
});

it("uses acquired facts only, preserves inputs, and keeps partial candidates visible", async () => {
  const f = candidateAssessmentFixture();
  const original = structuredClone(f);
  const port = { resolve: vi.fn(async () => ({ candidate: f.candidate, tripId: f.trip.id, taskId: "task", validUntil: "2026-09-13T08:00:00Z", assessmentFacts: f.facts })),
    loadTimetables: vi.fn(async () => { throw new Error("Must not fetch"); }) };
  const pair = await assessTripCandidate(f.trip, { candidateId: f.candidate.id, taskId: "task" }, port, assessmentAt);
  expect(port.loadTimetables).not.toHaveBeenCalled(); expect(pair.assessment.partial).toBe(true); expect(f).toEqual(original);
  const context = candidateAssessmentContext(pair);
  expect(context.candidate).toEqual({ id: f.candidate.id }); expect(context.currentTrip).toBeUndefined();
  expect(JSON.stringify(context)).not.toMatch(/sourceUrl|hourly|bookingUrl|delayMinutes/);
  const modelContext = buildAgentDecisionContext({ executionId: "assessment", feature: "concierge", userRequest: "比較したい",
    context: { currentTrip: { title: "採用済み", schedule: [] }, travelCandidates: [pair], realtimeFacts: [{ delayMinutes: 10 }] } }, []);
  const parsed = JSON.parse(agentDecisionContextText(modelContext).match(/<agent_context>([\s\S]*)<\/agent_context>/u)![1]!);
  expect(parsed.travelCandidates[0].assessment.price.observations[0].price.currency).toBe("EUR");
  expect(parsed.travelCandidates[0].assessment.hardConstraints[0].constraintId).toBe("region");
  expect(parsed.currentTrip.assessment).toBeUndefined(); expect(parsed.realtimeFacts[0].delayMinutes).toBe(10);
  const views = candidateAssessmentView(pair.assessment);
  expect(views.find((v) => v.label.startsWith("移動"))).toMatchObject({ tone: "warning" });
  expect(views.map((v) => v.label).join(" ")).toContain("EUR 120.00");
  for (const request of [{ candidateId: "other", taskId: "task" }, { candidateId: f.candidate.id, taskId: "other" }]) {
    await expect(assessTripCandidate(f.trip, request, port, assessmentAt)).rejects.toThrow();
  }
  await expect(assessTripCandidate(f.trip, { candidateId: f.candidate.id, taskId: "task" }, port, "2026-09-14T08:00:00Z")).rejects.toThrow();
});

it("IDs-only tool input rejects self-declared statuses; derived Evidence uses the existing Claim validator", async () => {
  const f = candidateAssessmentFixture();
  const pair = await assessTripCandidate(f.trip, { candidateId: f.candidate.id, taskId: "task" }, {
    resolve: async () => ({ candidate: f.candidate, tripId: f.trip.id, taskId: "task", validUntil: "2026-09-13T08:00:00Z", assessmentFacts: f.facts }),
    loadTimetables: async () => [],
  }, assessmentAt);
  expect(validateAgentToolInput(candidateAssessmentDescriptor.inputSchema, { candidateId: f.candidate.id, weather: "favorable" }).ok).toBe(false);
  const evidence = candidateAssessmentEvidence({ ...candidateAssessmentContext(pair), assessmentEvidence: pair.assessment.sources });
  expect(evidence[0]?.knowledgeKind).toBe("derived_value");
  expect(evidence[0]?.facts.weather).toBe("favorable");
  const claim = { id: "comparison", statement: "予報の比較結果", kind: "fact" as const, evidenceIds: [evidence[0]!.id],
    bindings: [{ evidenceId: evidence[0]!.id, fieldPath: "facts.weather", subjectRef: evidence[0]!.subject, transform: "identity" as const }] };
  expect(validateEvidenceAndClaims(evidence, [claim]).valid).toBe(true);
  expect(validateEvidenceAndClaims(evidence, [{ ...claim, evidenceIds: ["invented"] }]).valid).toBe(false);
});

it("returns the admitted assessment Evidence ID alongside the tool result", async () => {
  const f = candidateAssessmentFixture();
  const registry = new AgentToolRegistry();
  registerCandidateAssessmentTool(registry, {
    getCurrentTrip: () => f.trip,
    candidateSelection: { taskId: "task", port: {
      resolve: async () => ({ candidate: f.candidate, tripId: f.trip.id, taskId: "task", validUntil: "2026-09-13T08:00:00Z", assessmentFacts: f.facts }),
      loadTimetables: async () => [],
    } },
  }, () => new Date(assessmentAt));
  const result = await registry.execute("assess_travel_candidate", { candidateId: f.candidate.id }, { executionId: "assessment" });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const output = result.output as { answerEvidenceId: string };
  expect(output.answerEvidenceId).toBe(candidateAssessmentEvidence(output)[0]?.id);
  expect(output.answerEvidenceId).toMatch(/^candidate-assessment:/u);
});
