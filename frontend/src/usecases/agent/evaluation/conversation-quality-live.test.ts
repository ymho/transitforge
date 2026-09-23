import { describe, expect, it } from "vitest";
import type { ConversationQualityScenario } from "./evaluation-contract";
import { evaluateConversationQualityLive, presentedPhotoCount } from "./conversation-quality-live";

const scenario: ConversationQualityScenario = {
  id: "relaxed", name: "ゆっくり旅",
  input: { conversationId: "11111111-1111-4111-8111-111111111111", fixedNow: "2026-09-21T09:00:00+09:00", providerFixture: "west_japan_discovery",
    turns: [{ role: "user", text: "明日出発で、ゆっくりできる旅行を提案して欲しい" }] }, tags: [],
  expected: {
    destination: { mode: "discovery", minimumCandidates: 2, maximumCandidates: 3,
      recommendationScope: "loaded-timetable-west-japan-centered", forbiddenMainCandidates: ["熱海", "伊東"] },
    relativeDates: [{ sourceText: "明日出発", calendarDate: "2026-09-22" }],
    forbiddenRepeatedQuestions: ["travel_start_date", "destination", "origin"],
    assumptions: { allowed: ["origin"], mustBeExplicit: true, mustRemainUnconfirmed: true },
    requiredFinalCapabilities: ["multiple_destination_candidates", "candidate_comparison", "candidate_specific_itineraries", "candidate_photos"],
    maximumTurnsToStarterPlan: 1, minimumPlacePhotos: 2, maximumAskOnlyStreak: 0,
    maximumQuestionsPerAssistantTurn: 1, forbiddenProfilePromotions: ["origin"],
  },
};

describe("live conversation quality evaluator", () => {
  it("counts typed public photos with legacy observation compatibility and deduplication", () => {
    expect(presentedPhotoCount(["photo:public"], undefined)).toBe(1);
    expect(presentedPhotoCount(undefined, ["photo:legacy"])).toBe(1);
    expect(presentedPhotoCount(["photo:same"], ["photo:same", "photo:legacy"])).toBe(2);
    expect(presentedPhotoCount(undefined, undefined)).toBe(0);
  });

  it("accepts a grounded first-turn multi-candidate proposal", () => {
    const result = evaluateConversationQualityLive(scenario, [{
      response: "2026年9月22日出発です。1. 城崎温泉：温泉向き。1日目は街歩き。2. おごと温泉：アクセスが特徴。1日目は湖畔へ。出発地は未指定の前提です。",
      toolNames: ["search_web", "read_web_pages", "resolve_place_candidates"], photoCount: 2, claimStatuses: ["supported", "supported"],
    }]);
    expect(result.passed).toBe(true);
    expect(result.metrics).toMatchObject({ toolSelectionAccuracy: 1, constraintSatisfaction: 1, taskCompletion: 1 });
  });

  it("rejects questionnaires and unsupported out-of-scope candidates", () => {
    const result = evaluateConversationQualityLive(scenario, [{
      response: "熱海はいかがですか？ 出発地はどこからですか？ 出発地はプロフィールに保存します。",
      toolNames: [], photoCount: 0, claimStatuses: ["unsupported"],
    }]);
    expect(result.passed).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining([
      "必要な調査Toolが使われていない",
      "既知条件、相対日付、地域制約、質問抑制のいずれかを満たしていない",
    ]));
  });

  it("rejects promotion of a provisional assumption to the profile", () => {
    const result = evaluateConversationQualityLive(scenario, [{
      response: "2026年9月22日出発です。1. 城崎温泉：温泉向き。1日目は街歩き。2. おごと温泉：アクセスが特徴。1日目は湖畔へ。出発地は未指定の前提ですが、プロフィールに出発地として保存します。",
      toolNames: ["search_web", "resolve_place_candidates"], photoCount: 2, claimStatuses: ["supported"],
    }]);
    expect(result.passed).toBe(false);
    expect(result.metrics.constraintSatisfaction).toBeLessThan(1);
  });
});
