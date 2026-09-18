import type { Evidence } from "./evidence-model";
/** Shared projection of the existing representative-timetable operation, never live service claims. */
export function representativeTimetableEvidence(output: unknown, context: { retrievedAt: string }): Evidence[] {
  if (!output || typeof output !== "object" || !("matches" in output) || !Array.isArray(output.matches)) return [];
  const result = output as { serviceDate?: string; timetableKind?: string; matches: Array<{ trainNumber?: string; origin?: string; destination?: string }> };
  return result.matches.slice(0, 5).flatMap((match, index) => typeof match.trainNumber === "string" ? [{
    id: `representative:${result.serviceDate}:${index}`, category: "timetable" as const, knowledgeKind: "deterministic_fact" as const,
    subject: match.trainNumber, facts: { trainNumber: match.trainNumber, timetableKind: result.timetableKind ?? "unknown" },
    references: [{ sourceType: "timetable-index" as const, sourceRef: `${result.serviceDate}:${match.trainNumber}`,
      retrievedAt: context.retrievedAt, freshness: "scheduled" as const,
      summary: `${result.serviceDate}の代表ダイヤに${match.trainNumber}（${match.origin ?? "不明"}→${match.destination ?? "不明"}）を収録。特定日の運行は未確認` }],
  }] : []);
}
