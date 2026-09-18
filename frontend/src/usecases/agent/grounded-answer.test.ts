import { expect, it } from "vitest";
import { DefaultAgentResponseGenerator } from "./agent-response-generator";
import { parseGroundedAnswer, supportedAnswerClaims } from "./grounded-answer";
import type { Evidence } from "./evidence-model";
import type { AgentModelResponse } from "./model-provider";

const e: Evidence = { id: "route-1", category: "journey", knowledgeKind: "derived_value", subject: "京都から大阪", facts: {
  originStation: "京都", destinationStation: "大阪", serviceDate: "2026-09-20", departureTimeMinutes: 600, arrivalTimeMinutes: 630, durationMinutes: 30, transferCount: 0, trainNumbers: ["123A"], includesDelay: false,
}, references: [{ sourceType: "timetable-graph", sourceRef: "fixture:20260920", retrievedAt: "2026-09-18T00:00:00Z", freshness: "scheduled", summary: "検証済み経路" }] };
const answer = () => { const claims = supportedAnswerClaims([e]); return { text: claims.map(c => c.statement).join("\n\n"), claims }; };
const model = (text: string): AgentModelResponse => ({ message: { role: "assistant", content: [{ type: "text", text }] }, stopReason: "completed", metadata: { provider: "test" } });
it("Default production generator rejects omitted claims and free factual prose with actual Evidence", () => {
  const generator = new DefaultAgentResponseGenerator();
  for (const text of ['向日町から倉敷まで25分です。', JSON.stringify({ text: "京都から大阪へ5分です", claims: [] })]) {
    expect(() => generator.fromModel(model(text), [e])).toThrow();
  }
});
it.each([["京都", "向日町"], ["大阪", "倉敷"], ["2026-09-20", "2026-09-21"], ["所要30分", "所要5分"], ["10:00", "09:00"], ["123A", "999B"], ["乗換0回", "乗換2回"]])("rejects a mismatched bound fact %s → %s", (from, to) => {
  expect(() => parseGroundedAnswer(JSON.stringify(answer()).replaceAll(from, to), [e])).toThrow();
});
it("exact verified route produces an EvidenceClaim with natural, labelled route times", () => {
  const result = new DefaultAgentResponseGenerator().fromModel(model(JSON.stringify(answer())), [e]);
  expect(result.claims).toHaveLength(1); expect(result.text).toContain("2026-09-20の京都から大阪"); expect(result.text).toContain("所要30分");
  expect(result.text).not.toContain("durationMinutes=");
});
it("unavailable factual answer may only report unknown, never complete concrete values", () => {
  const claims = supportedAnswerClaims([]), generator = new DefaultAgentResponseGenerator();
  const result = generator.fromModel(model(JSON.stringify({ text: claims[0]!.statement, claims })), [], "grounded");
  expect(result.claims[0]?.kind).toBe("unknown"); expect(result.claims[0]?.evidenceIds).toEqual([]);
  expect(() => generator.fromModel(model("25分で到着します"), [], "grounded")).toThrow();
});
it("initial non-factual interaction does not require a Claim", () => {
  const generator = new DefaultAgentResponseGenerator();
  expect(generator.fromModel(model("こんにちは。どんな旅にしたいですか？"), [], "interaction").claims).toEqual([]);
});
it("a factual answer cannot append unbound prose or forge an Evidence reference", () => {
  const forged = answer(); forged.text += "現在その列車に乗車しています";
  expect(() => parseGroundedAnswer(JSON.stringify(forged), [e])).toThrow();
  const wrong = answer(); wrong.claims[0]!.evidenceIds = ["absent"];
  expect(() => parseGroundedAnswer(JSON.stringify(wrong), [e])).toThrow();
});
it("existing usedEvidenceIds select Application facts, never model-authored rail numbers", () => {
  const response = { ...model("向日町から倉敷へ25分です。現在乗車しています。"), declaredEvidenceIds: [e.id] };
  const result = new DefaultAgentResponseGenerator().fromModel(response, [e], "grounded");
  expect(result.text).toContain("京都から大阪"); expect(result.text).toContain("所要30分");
  expect(result.text).not.toContain("25分"); expect(result.text).not.toContain("現在乗車しています");
  expect(result.claims[0]?.evidenceIds).toEqual([e.id]);
});
it("choosing no Evidence yields an unknown Claim, not unbound model prose", () => {
  const result = new DefaultAgentResponseGenerator().fromModel({ ...model("25分です"), declaredEvidenceIds: [] }, [e], "grounded");
  expect(result.claims[0]?.kind).toBe("unknown"); expect(result.text).not.toContain("25分");
});
it("unknown selected Evidence is never converted into a successful answer", () => {
  expect(() => new DefaultAgentResponseGenerator().fromModel({ ...model("30分"), declaredEvidenceIds: ["missing"] }, [e], "grounded")).toThrow();
});
