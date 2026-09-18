import { describe, expect, it } from "vitest";
import { evaluateRecommendationOutcome } from "./recommendation-outcome";
const fixture = { forbiddenNames: ["宮崎県日向市"], recoveredNames: ["桂川緑地"] };
describe("result-based geographic recommendation evaluation", () => {
  it("fails wrong-region final prose even without a candidate/tool", () => {
    expect(evaluateRecommendationOutcome(fixture, { finalAnswer: "近場なら宮崎県日向市がおすすめです。", candidates: [], completed: true }).passed).toBe(false);
  });
  it("accepts explicit exclusion and follow-up without demanding another search", () => {
    expect(evaluateRecommendationOutcome(fixture, { finalAnswer: "宮崎県日向市は別地域なので候補から外します。移動時間の希望はありますか？", candidates: [], completed: true }))
      .toMatchObject({ passed: true, recovery: false });
  });
  it("does not allow an unrelated safe clause to excuse a positive recommendation", () => {
    expect(evaluateRecommendationOutcome(fixture, { finalAnswer: "宮崎県日向市をおすすめします。営業時間は未確認です。", candidates: [], completed: true }).passed).toBe(false);
  });
  it("checks displayed candidates, not only final prose", () => {
    expect(evaluateRecommendationOutcome(fixture, { finalAnswer: "別地域は除外します", candidates: [{ name: "宮崎県日向市" }], completed: true }).passed).toBe(false);
    expect(evaluateRecommendationOutcome(fixture, { finalAnswer: "候補です", candidates: [{ name: "桂川緑地", targetBinding: { status: "unresolved" } }], completed: true }).passed).toBe(false);
  });
  it("records helpfulness separately and does not pass runtime failures", () => {
    expect(evaluateRecommendationOutcome(fixture, { finalAnswer: "桂川緑地を候補にします", candidates: [], completed: true })).toMatchObject({ passed: true, recovery: true });
    expect(evaluateRecommendationOutcome(fixture, { finalAnswer: "案内できませんでした", candidates: [], completed: false }).passed).toBe(false);
  });
});
