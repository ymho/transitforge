import type { Evidence, EvidenceCoverage } from "./evidence-model";
import type { AgentToolDescriptor } from "./tool-contract";
import { modelToolDescription } from "./tool-contract";

/** Authored capability overlap guidance only. Does not select, hide or execute a Tool. */
const overlap: Record<string, EvidenceCoverage[]> = {
  search_direct_routes: ["rail.schedule", "rail.connection", "rail.impact"],
  search_trains: ["rail.schedule", "rail.impact"],
  search_train_arrivals: ["rail.schedule", "rail.impact"],
  query_train_delay_analysis: ["rail.impact", "rail.connection"],
  search_weather_forecast: ["weather.impact"],
  search_travel_alerts: ["hazard.impact"],
  ask_follow_up: ["trip.itinerary", "trip.next-item", "rail.impact", "rail.connection", "weather.impact", "hazard.impact", "location.permission", "reservation.state"],
};

export function evidenceAwareTool(tool: AgentToolDescriptor, evidence: readonly Evidence[]): AgentToolDescriptor {
  const scopes = overlap[tool.name];
  if (!scopes) return tool;
  const covered = evidence.filter((e) => e.references.some((r) =>
    ["trip-state", "trip-impact", "reservation-state", "session-state"].includes(r.sourceType)))
    .flatMap((e) => (e.coverage ?? []).filter((scope) => scopes.includes(scope))
      .map((scope) => `${scope}=${e.id}(${e.references[0]?.freshness ?? "unknown"})`)).slice(0, 12);
  if (!covered.length) return tool;
  const support = tool.decisionSupport ?? { capability: tool.description, responsibilityBoundary: "事実検証はTool、能力選択と説明はAgent" };
  const enhanced = { ...tool, decisionSupport: { ...support,
    suitableCases: [...(support.suitableCases ?? []), "新しい代替案・別区間/時刻・新しい観測が必要、または根拠が欠落/unknown/staleで最新確認が必要な依頼"],
    unsuitableCases: [...(support.unsuitableCases ?? []),
      "Application Evidenceで回答できる保存済み予定・Impact・測定値・未確認範囲の説明だけのための再取得",
      ...(tool.name === "ask_follow_up" ? ["unknown/unavailableを未確認として説明すれば答えられる相談。利用者にしか決められない条件ではない不足"] : [])],
    limitations: [...(support.limitations ?? []),
      `現在のApplication Evidence coverage: ${covered.join("; ")}`,
      "coverageは対象範囲であり安全確認・Tool禁止ではない。current/scheduledとunknown/historicalを区別し、区間・時刻・鮮度が質問に適合するか判断する。保存済みhazard uncertaintyの説明は最新警報の取得とは異なる"],
  } };
  return { ...enhanced, description: modelToolDescription(enhanced) };
}
