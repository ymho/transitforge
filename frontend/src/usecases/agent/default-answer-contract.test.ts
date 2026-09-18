import { describe, expect, it } from "vitest";
import { DefaultAgentResponseGenerator } from "./agent-response-generator";
import type { AgentModelResponse } from "./model-provider";
import type { Evidence, EvidenceClaim } from "./evidence-model";

const evidence: Evidence = { id: "route", category: "journey", knowledgeKind: "deterministic_fact",
  subject: "京都→大阪", facts: { serviceDate: "2026-09-18", duration: 30 },
  references: [{ sourceType: "timetable-index", sourceRef: "index", retrievedAt: null, freshness: "scheduled", summary: "時刻表" }] };
const claim: EvidenceClaim = { id: "c", statement: "採用する計画値", kind: "fact", evidenceIds: ["route"],
  binding: { subject: evidence.subject, facts: evidence.facts } };
function answer(claims?: EvidenceClaim[]): AgentModelResponse {
  return { message: { role: "assistant", content: [{ type: "text", text: "京都から大阪へ1分で行けます" }] },
    stopReason: "completed", metadata: { provider: "test" }, decisionSummary: {
      interpretedGoal: "経路を説明", hardConstraints: [], softPreferences: [], selectedAction: "answer",
      unresolvedFacts: [], reasonCodes: ["evidence_sufficient"], usedEvidenceIds: ["route"], claims } };
}
describe("production Default answer Claim contract", () => {
  const generator = new DefaultAgentResponseGenerator();
  it("rejects concrete prose without Claims", () => expect(() => generator.fromModel(answer(), [evidence])).toThrow());
  it.each([
    { subject: "東京→大阪", facts: evidence.facts },
    { subject: evidence.subject, facts: { serviceDate: "2026-09-19" } },
    { subject: evidence.subject, facts: { duration: 1 } },
  ])("rejects mismatched typed binding %j", binding => {
    expect(() => generator.fromModel(answer([{ ...claim, binding }]), [evidence])).toThrow();
  });
  it("rejects missing Evidence", () => expect(() => generator.fromModel(answer([claim]), [])).toThrow());
  it("renders verified values rather than contradictory free prose", () => {
    const result = generator.fromModel(answer([claim]), [evidence]);
    expect(result.text).toContain("30"); expect(result.text).not.toContain("1分");
  });
  it("renders unavailable as unknown without concrete values", () => {
    const result = generator.fromModel(answer([{ id: "unknown", kind: "unknown", statement: "未確認", evidenceIds: [] }]), []);
    expect(result.text).toBe("必要な事実は確認できていません。");
  });
});
