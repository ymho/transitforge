import type { AgentToolDescriptor } from "./tool-contract";
import type { AgentPlan, AgentProblemFrame } from "./runtime-contract";

export interface AgentPlanner {
  createPlan(
    problem: AgentProblemFrame,
    availableTools: AgentToolDescriptor[],
  ): AgentPlan;
}

export class DefaultAgentPlanner implements AgentPlanner {
  createPlan(
    problem: AgentProblemFrame,
    availableTools: AgentToolDescriptor[],
  ): AgentPlan {
    if (problem.missingInformation.length > 0) {
      return { steps: ["不足情報を利用者へ確認する"] };
    }
    if (problem.feature === "travel_planning") {
      const available = new Set(availableTools.map(({ name }) => name));
      const research = [
        ["search_direct_routes", "鉄道経路と移動負担を確認する"],
        ["search_accommodations", "宿泊候補を確認する"],
        ["search_weather_forecast", "旅行日の天気と代替条件を確認する"],
        ["search_travel_alerts", "旅行先について気象庁から直近に発表された防災情報を確認する"],
        ["search_place_media", "興味と空き時間に合う検証済みPlaceを確認する"],
        ["search_ground_access", "駅から候補地点までの徒歩または車の負担を確認する"],
        ["search_restaurants", "旅程の時間と場所に合う食事候補を確認する"],
        ["search_web", "不足する観光候補や最新情報をWebから発見する"],
        ["read_web_pages", "上位の異なる情報源を読みEvidenceを補う"],
        ["resolve_place_candidates", "Webで確認した施設をMapbox POIへ照合する"],
      ].flatMap(([tool, step]) => available.has(tool) ? [step] : []);
      return { steps: [
        "プロフィールと今回条件から旅行の目的と負担上限を整理する",
        ...research,
        "Evidenceの鮮度と不足情報を確認して必要なら再計画する",
        "推奨案 比較案 理由 次に調べる一項目を提示する",
      ] };
    }
    return {
      steps: [
        `依頼を${problem.normalizedIntent}として整理する`,
        availableTools.length > 0
          ? "必要なDomain Toolを選び順序付きで実行する"
          : "利用可能な情報だけで回答可否を判断する",
        "Evidenceと情報不足を確認する",
        "根拠の範囲内で回答する",
      ],
    };
  }
}
