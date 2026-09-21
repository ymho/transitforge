import { expect, it } from "vitest";
import { DefaultAgentResponseGenerator } from "@raiquora/agent/agent-response-generator";
import { groundedAnswerInstruction, parseGroundedAnswer, supportedAnswerClaims, sourceExplanation, travelPlan } from "@raiquora/agent/grounded-answer";
import type { Evidence } from "@raiquora/agent/evidence-model";
import type { AgentModelResponse } from "@raiquora/agent/model-provider";

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
it("describes the selected comparison's verified route instead of an anonymous assessment", () => {
  const evidence: Evidence = { ...e, id: "candidate-comparison", category: "external", facts: {
    candidateId: "internal-id", constraintStatus: "unknown", originStation: "A", destinationStation: "C", serviceDate: "2026-09-13",
    plannedTravelMinutes: 100, plannedTransfers: 1, serviceCoverage: "supported", hardUnknown: ["origin"],
  } };
  const text = supportedAnswerClaims([evidence])[0]!.statement;
  expect(text).toContain("2026-09-13のAからC"); expect(text).toContain("100分"); expect(text).toContain("乗換は1回");
  expect(text).toContain("対応範囲内"); expect(text).toContain("未確認"); expect(text).not.toContain("internal-id");
});
it.each(["向日町から倉敷まで25分です", "10:00発、10:30着です", "やくも27号です", "二十五分で到着します"])("rejects invented initial rail values even with no Tool/Evidence: %s", (text) => {
  expect(() => new DefaultAgentResponseGenerator().fromModel(model(text), [], "interaction")).toThrow();
});
const placeEvidence: Evidence = { id: "place-source", category: "external", knowledgeKind: "deterministic_fact", subject: "歴史の町",
  facts: { sourceTitle: "歴史の町", sourceExcerpt: "白壁の町並みを歩きながら歴史資料館を巡れます。川沿いに休憩所があります。", sourceUrl: "https://example.org/history", sourcePrecision: "read-page", status: "available", freshness: "fresh" },
  references: [{ sourceType: "external-source", sourceRef: "https://example.org/history", retrievedAt: "2026-09-18T00:00:00Z", freshness: "current", summary: "観光案内" }] };
it("gives the model bounded, real preference choices without forwarding private notes as instructions", () => {
  const instruction = groundedAnswerInstruction([placeEvidence], { favoriteInterests: ["歴史"],
    consentedPreferenceNotes: { avoidances: "非公開の自由記述" } });
  expect(instruction).toContain('"field":"favoriteInterests","value":"歴史"');
  expect(instruction).toContain("推薦質問を資料の列挙だけで終えてはいけません");
  expect(instruction).not.toContain("非公開の自由記述");
});
it("describes actual place features with attribution instead of a generic acquisition message", () => {
  const result = new DefaultAgentResponseGenerator().fromModel({ ...model(JSON.stringify({ kind: "source-explanation", sections: [{ evidenceId: placeEvidence.id,
    quote: String(placeEvidence.facts.sourceExcerpt), mode: "feature" }] })), declaredEvidenceIds: [placeEvidence.id] }, [placeEvidence]);
  expect(result.text).toContain("白壁の町並み"); expect(result.text).toContain("https://example.org/history");
  expect(result.text).not.toContain("外部情報の取得結果があります");
  const fallback = new DefaultAgentResponseGenerator().fromModel({ ...model("自由な推薦文"), declaredEvidenceIds: [placeEvidence.id] }, [placeEvidence]);
  expect(fallback.text).not.toContain("自由な推薦文"); expect(fallback.text).toContain("白壁の町並み");
});
it("separates a Profile-based recommendation from the source's actual description", () => {
  const result = sourceExplanation(JSON.stringify({ kind: "source-explanation", sections: [{ evidenceId: placeEvidence.id,
    quote: "白壁の町並みを歩きながら歴史資料館を巡れます。", mode: "recommendation", preference: { field: "favoriteInterests", value: "歴史" } }] }), [placeEvidence], { favoriteInterests: ["歴史"] })!;
  expect(result.claims.map((c) => c.kind)).toEqual(["fact", "inference"]);
  expect(result.text).toContain("普段の好み「歴史」"); expect(result.text).toContain("歴史資料館");
  expect(() => sourceExplanation(JSON.stringify({ kind: "source-explanation", sections: [{ evidenceId: placeEvidence.id, quote: "架空の無料列車", mode: "feature" }] }), [placeEvidence])).toThrow();
});
it("a factual answer cannot append unbound prose or forge an Evidence reference", () => {
  const forged = answer(); forged.text += "現在その列車に乗車しています";
  expect(() => parseGroundedAnswer(JSON.stringify(forged), [e])).toThrow();
  const wrong = answer(); wrong.claims[0]!.evidenceIds = ["absent"];
  expect(() => parseGroundedAnswer(JSON.stringify(wrong), [e])).toThrow();
});
it("renders a labelled source contract without losing its recommendation or exposing surrounding prose", () => {
  const encoded = JSON.stringify({ kind: "source-explanation", sections: [{ evidenceId: placeEvidence.id,
    quote: "白壁の町並みを歩きながら歴史資料館を巡れます。", mode: "recommendation", preference: { field: "favoriteInterests", value: "歴史" } }] });
  const generator = new DefaultAgentResponseGenerator();
  for (const text of [`回答:\n${encoded}`, `\`\`\`json\n${encoded}\n\`\`\``, `現在この場所にいます。${encoded}無料列車で5分です。`]) {
    const result = generator.fromModel({ ...model(text), declaredEvidenceIds: [placeEvidence.id] }, [placeEvidence], "grounded", { favoriteInterests: ["歴史"] });
    expect(result.claims.map((c) => c.kind)).toEqual(["fact", "inference"]);
    expect(result.text).toContain("普段の好み「歴史」");
    expect(result.text).not.toMatch(/現在この場所|無料列車|5分|回答:/u);
  }
  expect(() => generator.fromModel(model(`回答:${encoded.replace("歴史資料館", "無料列車")}`), [placeEvidence])).toThrow();
  expect(() => generator.fromModel({ ...model(`回答:${encoded}`), invalidUsedEvidenceIds: true }, [placeEvidence])).toThrow();
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

const photographedPlace: Evidence = { ...placeEvidence, id: "place-photo", subject: "出雲大社", facts: { ...placeEvidence.facts,
  sourceTitle: "出雲大社", sourceExcerpt: "御本殿や神楽殿を巡り、門前町の散策を楽しめます。", sourceUrl: "https://example.org/izumo",
  placeName: "出雲大社", imageUrl: "https://images.example.org/izumo.jpg", imageSourceUrl: "https://photos.example.org/izumo",
  imageAttribution: "撮影者 Example", imageLicense: "CC BY 4.0", boundSourceUrls: ["https://example.org/izumo"] },
  references: [{ ...placeEvidence.references[0]!, sourceRef: "https://example.org/izumo" }] };
const plan = (overrides: Record<string, unknown> = {}) => JSON.stringify({ kind: "travel-plan", startDate: "2026-09-22", candidates: [{
  evidenceId: photographedPlace.id, quote: photographedPlace.facts.sourceExcerpt, photoEvidenceId: photographedPlace.id,
  itinerary: [{ day: 1, activities: [{ period: "afternoon", activity: "visit_featured_place" }, { period: "evening", activity: "check_in_and_rest" }] },
    { day: 2, activities: [{ period: "morning", activity: "quiet_morning" }, { period: "afternoon", activity: "souvenir_and_departure" }] }],
  estimate: { currency: "JPY", partySize: 1, nights: 1, originTravel: "excluded", lodgingClass: "standard",
    items: { transport: 0, accommodation: 18000, sightseeing: 2000, food: 7000 } }, ...overrides,
}] });
it("renders a grounded itinerary, all-party AI estimate, and bound photo in one answer", () => {
  const result = travelPlan(plan(), [photographedPlace])!;
  expect(result.text).toContain("2026年9月22日");
  expect(result.text).toContain("1日目 午後");
  expect(result.text).toContain("AI概算（旅行全体・利用者全員分）");
  expect(result.text).toContain("合計：27,000円");
  expect(result.text).toContain("目的地までの往復交通は含めていません");
  expect(result.text).toContain('https://images.example.org/izumo.jpg "Raiquora verified photo"');
  expect(result.claims.map(({ kind }) => kind)).toEqual(["fact", "inference"]);
});
it("rejects unbound photos, source text, and incomplete estimates", () => {
  expect(() => travelPlan(plan({ quote: "架空の無料列車" }), [photographedPlace])).toThrow();
  expect(() => travelPlan(plan({ photoEvidenceId: "missing" }), [photographedPlace])).toThrow();
  expect(() => travelPlan(plan({ estimate: { currency: "JPY", partySize: 1, nights: 1, originTravel: "excluded", lodgingClass: "standard", items: { accommodation: 10 } } }), [photographedPlace])).toThrow();
});
it("does not let model prose forge the reserved photo presentation", () => {
  expect(() => new DefaultAgentResponseGenerator().fromModel(model('![追跡画像](https://tracker.example/pixel.jpg "Raiquora verified photo")'), [], "interaction")).toThrow();
});
