import type { Evidence, EvidenceClaim } from "./evidence-model";
import type { AgentGeneratedResponse } from "./agent-response-generator";

/** Statements are Application projections of actual Evidence, not model-authored facts.
 * Selection/order belongs to the model. Existing terminal/Proposal/InTrip presenters do not enter here. */
export function supportedAnswerClaims(evidence: readonly Evidence[]): EvidenceClaim[] {
  if (!evidence.length) return [{ id: "information-unconfirmed", statement: "必要な情報はまだ確認できていません。具体的な経路や時刻は補完せず、追加で確認する必要があります。", kind: "unknown", evidenceIds: [] }];
  return evidence.slice(0, 40).flatMap((e, i) => {
    if (!e.references.length || e.knowledgeKind === "model_interpretation") return [];
    const statement = statementFor(e);
    return statement ? [{ id: `fact-${i}`, statement, kind: e.knowledgeKind === "unverified_information" ? "inference" as const : "fact" as const, evidenceIds: [e.id] }] : [];
  });
}

function statementFor(e: Evidence): string | undefined {
  const f = e.facts;
  if (e.category === "journey" && typeof f.originStation === "string" && typeof f.destinationStation === "string" && typeof f.serviceDate === "string" &&
      typeof f.departureTimeMinutes === "number" && typeof f.arrivalTimeMinutes === "number" && typeof f.durationMinutes === "number" && typeof f.transferCount === "number") {
    return `${f.serviceDate}の${f.originStation}から${f.destinationStation}への検索結果です。${time(f.departureTimeMinutes)}発、${time(f.arrivalTimeMinutes)}着、所要${f.durationMinutes}分、乗換${f.transferCount}回です。` +
      (Array.isArray(f.trainNumbers) ? `列車: ${f.trainNumbers.join("、")}。` : "") +
      (f.includesDelay === true ? "遅延補正を含む検索時点の見込みであり、時刻表上の計画時刻とは区別してください。" : "時刻表に基づく検索結果で、実際の乗車や運行を保証するものではありません。");
  }
  if (e.knowledgeKind === "unverified_information") return `${e.subject}は未確認です。具体的な値を補完せず、必要なら追加で調べます。`;
  if (e.category === "train" && typeof f.arrivalTimeMinutes === "number" && typeof f.stationName === "string") {
    return `表示中の列車indexでは${String(f.trainName || f.trainNumber || e.subject)}の${f.stationName}到着は${time(f.arrivalTimeMinutes)}です。利用日の運行と実際の到着は別途確認が必要です。`;
  }
  if (e.category === "external") {
    if (typeof f.candidateId === "string") {
      const status = f.constraintStatus === "satisfied" ? "確認した条件は成立しています" : f.constraintStatus === "violated" ? "成立しない条件があります" : "条件の成立に未確認事項があります";
      return `取得済みの候補評価では、${status}。` +
        (typeof f.plannedTravelMinutes === "number" ? `確認済みの移動時間は${f.plannedTravelMinutes}分です。` : "移動時間はこの根拠では確認できません。") +
        (Array.isArray(f.hardUnknown) && f.hardUnknown.length ? "必須条件に未確認事項があるため、成立扱いせず追加確認が必要です。" : "") +
        (Array.isArray(f.hardViolations) && f.hardViolations.length ? "必須条件への違反があるため、このまま採用できるとは案内できません。" : "") +
        "候補比較であり、採用・予約・現在の安全を保証するものではありません。";
    }
    if (f.status !== "available" || f.freshness !== "fresh") return "外部情報は未確認、または鮮度を確認できていません。移動の成立・空き状況・天気や警報に問題がないとは判断できません。必要な情報を追加確認してください。";
    return "外部情報の取得結果があります。内容と出典を確認してください。検索結果があるだけでは、移動の成立・空き状況・今回の旅への影響を確認したことにはなりません。";
  }
  // These summaries originate in registered Application Tool adapters. No arbitrary model text
  // or subject:key=value dump is converted into a factual explanation.
  if (e.references.every((r) => r.sourceType !== "model")) {
    return [...new Set(e.references.map((r) => r.summary).filter(Boolean))].slice(0, 4).join("。") + "。";
  }
  return undefined;
}
function time(minutes: number): string {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 7 * 1440) throw new Error("Invalid route time");
  const days = Math.floor(minutes / 1440), within = minutes % 1440;
  return `${days ? `${days}日後 ` : ""}${String(Math.floor(within / 60)).padStart(2, "0")}:${String(within % 60).padStart(2, "0")}`;
}

/** Same EvidenceClaim contract; text cannot carry facts absent from the selected claims. */
export function parseGroundedAnswer(text: string, evidence: readonly Evidence[]): AgentGeneratedResponse {
  const value: unknown = JSON.parse(text);
  if (!record(value) || Object.keys(value).some((k) => !["text", "claims"].includes(k)) || typeof value.text !== "string" ||
      value.text.length > 8000 || !Array.isArray(value.claims) || !value.claims.length || value.claims.length > 8) throw new Error("Missing factual claims");
  const allowed = supportedAnswerClaims(evidence);
  const claims: EvidenceClaim[] = value.claims.map((claim) => {
    if (!record(claim) || Object.keys(claim).some((k) => !["id", "statement", "kind", "evidenceIds"].includes(k)) ||
        typeof claim.id !== "string" || !claim.id || claim.id.length > 200 || !Array.isArray(claim.evidenceIds)) throw new Error("Invalid claim");
    const matched = allowed.find((a) => a.statement === claim.statement && a.kind === claim.kind &&
      JSON.stringify(a.evidenceIds) === JSON.stringify(claim.evidenceIds));
    if (!matched) throw new Error("Unsupported statement or mismatched subject/facts");
    return { ...matched, id: claim.id };
  });
  if (new Set(claims.map((c) => c.id)).size !== claims.length || value.text.trim() !== claims.map((c) => c.statement).join("\n\n")) throw new Error("Unbound response text");
  return { text: value.text.trim(), claims, viewerActions: [] };
}
/** The existing decision-summary references select factual presentations. Model prose is not
 * displayed on this lane: Application constructs the claims and their exact bound values. */
export function presentGroundedEvidence(ids: readonly string[], evidence: readonly Evidence[]): AgentGeneratedResponse {
  if (!ids.length || ids.length > 8 || new Set(ids).size !== ids.length || ids.some((id) => !evidence.some((e) => e.id === id))) throw new Error("Invalid factual references");
  const claims = ids.flatMap((id) => supportedAnswerClaims(evidence.filter((e) => e.id === id)));
  if (claims.length !== ids.length) throw new Error("Missing factual presentation");
  const bound = claims.map((claim, index) => ({ ...claim, id: `fact-${index}` }));
  return { text: bound.map((c) => c.statement).join("\n\n"), claims: bound, viewerActions: [] };
}
export function groundedAnswerInstruction(evidence: readonly Evidence[]): string {
  const claims = supportedAnswerClaims(evidence);
  return `外部事実の最終回答ではdecision_summary.usedEvidenceIdsに必要な実在Evidence IDを選んでください。Applicationが選択されたEvidenceから次のClaimを描画するため、事実本文を再作成する必要はありません。必要な根拠がなければ追加Toolを判断してください。根拠が0件で取得不能ならJSON {"text":"unknown Claimのstatement","claims":[unknown Claim]}で未確認を示せます。既存のterminal Tool/Proposal/InTripAnswerPlanは従来どおりです。利用可能Claim: ${JSON.stringify(claims)}`;
}
function record(v: unknown): v is Record<string, unknown> { return typeof v === "object" && v !== null && !Array.isArray(v); }
