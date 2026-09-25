import type { Evidence } from "./evidence-model";
import type { AgentGeneratedResponse } from "./agent-response-generator";
import { hasStructuredPresentationEvidence, sourceDisplayExcerpt, sourceExplanation, sourcePresentationScore } from "./grounded-answer";
import { parsePublicPlanPresentation, type PublicPlanCandidate } from "./public-plan-presentation";
import type { EffectiveIntent } from "./effective-intent";

/** A conservative, source-bound draft when the model cannot complete its presentation.
 * No timetable, accommodation, fare, or second place is invented. */
export function recoverPlanningDraft(evidence: readonly Evidence[], intent?: EffectiveIntent): AgentGeneratedResponse | undefined {
  const sources = evidence.filter((source) => hasStructuredPresentationEvidence(source) &&
    typeof source.facts.sourceUrl === "string" && source.references.some((ref) => ref.sourceRef === source.facts.sourceUrl) &&
    typeof source.facts.sourceExcerpt === "string" && Boolean(sourceDisplayExcerpt(source.facts.sourceExcerpt)));
  const selected = sources.sort((left, right) => sourcePresentationScore(right) - sourcePresentationScore(left))
    .filter((source, index, all) => all.findIndex((item) => normalizedTitle(item) === normalizedTitle(source)) === index)
    .slice(0, 2);
  if (!selected.length) return undefined;
  const date = exactStartDate(intent);
  const sections: string[] = [date
    ? `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日出発の条件を保持しています。確認済み資料から作った限定的な案です。往復の移動時刻と費用はまだ確認できていません。`
    : "確認済み資料から作った限定的な案です。出発日は確定しておらず、移動時刻と費用はまだ確認できていません。"];
  const candidates: PublicPlanCandidate[] = [];
  const claims: AgentGeneratedResponse["claims"] = [];
  const photoRefs: string[] = [];
  for (const source of selected) {
    const quote = shortBoundQuote(source.facts.sourceExcerpt as string);
    if (!quote) continue;
    const explanation = sourceExplanation(JSON.stringify({ kind: "source-explanation", sections: [
      { evidenceId: source.id, quote, mode: "feature" },
    ] }), evidence);
    if (!explanation) continue;
    const title = String(source.facts.placeName ?? source.facts.sourceTitle ?? source.subject).split(/[|｜]/u, 1)[0]!.trim().slice(0, 100);
    const variantId = `variant:${source.id}`;
    const dayRef = `${variantId}:day:1`;
    const activityRef = `${dayRef}:visit`;
    const photo = evidence.find((item) => typeof item.facts.imageUrl === "string" && /^https:\/\//u.test(item.facts.imageUrl) &&
      typeof item.facts.imageSourceUrl === "string" && /^https:\/\//u.test(item.facts.imageSourceUrl) &&
      typeof item.facts.imageAttribution === "string" && item.facts.imageAttribution.trim() &&
      (item.id === source.id || Array.isArray(item.facts.boundSourceUrls) && item.facts.boundSourceUrls.includes(source.facts.sourceUrl as string)));
    if (photo) photoRefs.push(photo.id);
    const image = photo ? `![${escapeText(title)}](${photo.facts.imageUrl} "Raiquora verified photo")\n\n[写真: ${escapeText(String(photo.facts.imageAttribution))}](${photo.facts.imageSourceUrl} "写真の出典")\n\n` : "";
    sections.push(`${image}${escapeText(quote)} [出典 ↗](${source.facts.sourceUrl} "参考資料")`);
    claims.push(...explanation.claims.map((claim) => ({ ...claim, id: `draft-${claims.length}` })));
    const entries = [{ entryRef: `${dayRef}:entry:1`, itemRef: activityRef, role: "visit" as const }];
    candidates.push({ variantId, label: title, dayOrder: [dayRef], days: [{ dayRef, label: "1日目", entries, status: "planned" }],
      items: [{ itemRef: activityRef, sourceRef: activityRef, title: `${title}を訪ねる`, kind: "activity", timing: "unscheduled", evidenceRefs: [source.id], photoRefs: photo ? [photo.id] : [] }],
      unknowns: [date ? "移動時刻・費用は未確認" : "出発日・移動時刻・費用は未確認"], workload: { status: "unknown" }, cost: { status: "unknown" },
      comparisonAssessmentRefs: [], scenarioRefs: [] });
  }
  if (!candidates.length) return undefined;
  sections.push("確認できていない移動・宿泊・費用は、この案へ補完していません。");
  const presentation = parsePublicPlanPresentation({ version: "public-plan-presentation-v1", presentationId: "00000000-0000-4000-8000-000000000001",
    candidateSetRef: { kind: "unavailable", reason: "legacy-projection" }, candidateOrder: candidates.map((item) => item.variantId), candidates,
    evidenceRefs: selected.filter((source) => candidates.some((item) => item.variantId === `variant:${source.id}`)).map((source) => source.id),
    photoRefs: [...new Set(photoRefs)], coverage: { status: "partial", coveredDayRefs: candidates.flatMap((item) => item.dayOrder), omittedDayRefs: [], omittedScopes: [date ? "移動・宿泊・費用は未確認" : "出発日・移動・宿泊・費用は未確認"] },
    statements: candidates.map((item) => ({ kind: "fact", ref: `source:${item.variantId}`, evidenceRefs: [item.variantId.slice("variant:".length)] })),
    comparisonAssessmentRefs: [], scenarioRefs: [], researchOutcome: { status: "partial", requestedMode: "standard", effectiveMode: "standard",
      budget: { modelCalls: 0, toolCalls: 0, wallClockMs: 0 }, coveredScopes: ["候補の確認済み資料"], remainingScopes: [date ? "移動・宿泊・費用" : "出発日・移動・宿泊・費用"] } });
  return { text: sections.join("\n\n"), claims, publicPlanPresentation: presentation };
}

function normalizedTitle(source: Evidence): string {
  return String(source.facts.placeName ?? source.facts.sourceTitle ?? source.subject).split(/[|｜]/u, 1)[0]!.normalize("NFKC").replace(/\s/gu, "");
}
function exactStartDate(intent: EffectiveIntent | undefined): string | undefined {
  const conversation = intent?.actualConversationFacts.find(({ target, value }) => target === "start_date" && value.kind === "local_date");
  if (conversation?.value.kind === "local_date") return conversation.value.date;
  const base = intent?.activeBaseFacts.find(({ target, requirement }) => target === "start_date" && requirement.type === "dates" &&
    requirement.start.earliest === requirement.start.latest);
  return base?.requirement.type === "dates" ? base.requirement.start.earliest : undefined;
}
function shortBoundQuote(excerpt: string): string | undefined {
  const clean = sourceDisplayExcerpt(excerpt);
  if (!clean) return undefined;
  const sentence = clean.split(/(?<=[。！？])/u).find((part) => part.length >= 12 && part.length <= 180 && excerpt.includes(part));
  if (sentence) return sentence;
  const line = excerpt.split(/\n/gu).map((part) => part.trim()).find((part) => part.length >= 12 && /[。！？]/u.test(part));
  return line?.slice(0, Math.min(160, line.length));
}
function escapeText(value: string): string { return value.replace(/[<>&*_`\[\]\\]/gu, (char) => `&#${char.charCodeAt(0)};`); }
