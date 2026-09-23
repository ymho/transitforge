import { describe, expect, it } from "vitest";

import { agentSystemPrompt } from "./agent-system-prompt.js";

describe("agentSystemPrompt", () => {
  it("accepts Application Evidence without promoting general Context or requiring questions for unknowns", () => {
    expect(agentSystemPrompt).toContain("ApplicationがverifiedFactsとして明示したEvidence");
    expect(agentSystemPrompt).toContain("再確認のためだけにToolを呼ばず");
    expect(agentSystemPrompt).toContain("未検証候補はEvidenceではありません");
    expect(agentSystemPrompt).toContain("質問必須ではありません");
    expect(agentSystemPrompt).not.toContain("Tool Evidenceだけ");
    expect(agentSystemPrompt).toContain('"usedEvidenceIds":[]');
    expect(agentSystemPrompt).toContain("agent_turn_result JSON Schemaを外側の唯一の形式");
    expect(agentSystemPrompt).toContain("外側のagent_turn_resultのdecision fieldへ設定");
    expect(agentSystemPrompt).not.toContain("<decision_summary>");
    expect(agentSystemPrompt).not.toContain("decision_summaryタグの後");
    expect(agentSystemPrompt).toContain("in_tripのanswerだけで必須");
    expect(agentSystemPrompt).toContain("最大10件、重複なし");
    expect(agentSystemPrompt).toContain("キーごと省略");
  });
  it("keeps decision principles while delegating capability selection to descriptors", () => {
    expect(agentSystemPrompt).toContain("goal hard constraint soft preference");
    expect(agentSystemPrompt).toContain("既知の条件を聞き直さず");
    expect(agentSystemPrompt).toContain("正確な名称や駅名 時刻を知らなくても相談できます");
    expect(agentSystemPrompt).toContain("仮定を利用者の確定条件や永続的な好みとして保存しない");
    expect(agentSystemPrompt).toContain("目的地近くの起点を自宅扱いせず");
    expect(agentSystemPrompt).not.toContain("Contextや発話にない必須値を推測しない");
    expect(agentSystemPrompt).toContain("一度に一つ短く確認");
    expect(agentSystemPrompt).toContain("Toolの能力 適するケース 適さないケース");
    expect(agentSystemPrompt).toContain("検索 質問 変更を回答textだけで代替せず");
    expect(agentSystemPrompt).toContain("Tool結果ごとに");
    expect(agentSystemPrompt).toContain("検索Toolが発見できる候補");
    expect(agentSystemPrompt).toContain("幅を持つ希望はsoft preference");
    expect(agentSystemPrompt).toContain("場所の性質や気分を固有の目的地と決めつけず");
    expect(agentSystemPrompt).toContain("currentJourneyやcurrentTripに検証済み対象");
    expect(agentSystemPrompt).toContain("Tool失敗時は別能力");
    expect(agentSystemPrompt).toContain("内部処理の完了だけを回答にせず");
    expect(agentSystemPrompt).toContain("利用者へ逆質問しない");
    expect(agentSystemPrompt).toContain("私ならそうする理由");
    expect(agentSystemPrompt).toContain("地図SDKの操作説明");
    expect(agentSystemPrompt).toContain("Chain-of-Thought");
    expect(agentSystemPrompt).not.toContain("search_accommodations");
    expect(agentSystemPrompt).not.toContain("plan_day_trip");
    expect(agentSystemPrompt).not.toContain("search_place_media");
  });

  it("requires progress after the user permits provisional assumptions", () => {
    expect(agentSystemPrompt).toContain("利用者が不明条件を仮定してよいと明示した場合");
    expect(agentSystemPrompt).toContain("仮旅程や概算まで進めてください");
    expect(agentSystemPrompt).toContain("置いた前提と未確認範囲を回答内で明示してください");
  });

  it("uses calculated relative dates and does not promote Profile preferences to request facts", () => {
    expect(agentSystemPrompt).toContain("利用者へ日付を聞き返さないでください");
    expect(agentSystemPrompt).toContain("今回の発話にない出発地・同行者・自然等の関心を確定条件として確認せず");
  });

  it("returns a photographed starter plan instead of a destination questionnaire", () => {
    expect(agentSystemPrompt).toContain("旅行相談の初回価値を質問票にしないでください");
    expect(agentSystemPrompt).toContain("日ごとの簡単な行程");
    expect(agentSystemPrompt).toContain("具体的な候補を2〜3件比較して");
    expect(agentSystemPrompt).toContain("候補ごとの代表写真を取得し");
    expect(agentSystemPrompt).toContain("Web検索だけで最終回答せず");
    expect(agentSystemPrompt).toContain("写真URLや出典を推測しないでください");
    expect(agentSystemPrompt).toContain("travel-planを使って");
    expect(agentSystemPrompt).toContain("旅行全体かつ利用者全員分のAI概算");
  });

  it("centers open-ended discovery on loaded West Japan coverage without inventing a geographic allowlist", () => {
    expect(agentSystemPrompt).toContain("収録された駅・時刻表がある西日本エリアを中心");
    expect(agentSystemPrompt).toContain("西日本という地名だけで対応範囲内と断定せず");
    expect(agentSystemPrompt).toContain("serviceCoverageに従ってください");
    expect(agentSystemPrompt).toContain("範囲外の場所を明示した相談は拒まず");
  });
});
