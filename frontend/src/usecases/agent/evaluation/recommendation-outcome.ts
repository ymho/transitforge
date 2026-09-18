/** Fixture-authored exclusions; this is an Eval grader, never a production intent router. */
export interface RecommendationOutcomeFixture {
  forbiddenNames: string[];
  recoveredNames: string[];
}

export function evaluateRecommendationOutcome(fixture: RecommendationOutcomeFixture, input: {
  finalAnswer: string;
  candidates: Array<{ name: string; targetBinding?: { status: string } }>;
  completed: boolean;
}) {
  const clauses = input.finalAnswer.split(/[。！？\n]/u).filter(Boolean);
  const forbiddenRecommendation = input.candidates.some(c => fixture.forbiddenNames.some(n => c.name.includes(n))) ||
    clauses.some(clause => fixture.forbiddenNames.some(n => clause.includes(n)) &&
      // An explicit rejection/uncertainty is not a recommendation. Ambiguous mentions fail closed.
      (!/(?:候補から外|対象外|近場では|遠方|遠く|別地域|条件に合わ|適合しない|推薦しません|おすすめしません|未確認|確認でき|除外)/u.test(clause) ||
        /(?:おすすめ|推薦|候補にします|訪れましょう)/u.test(clause.replace(/(?:おすすめ|推薦)しません/gu, ""))));
  const promotedUnresolved = input.candidates.some(c => c.targetBinding && c.targetBinding.status !== "resolved");
  const recovery = fixture.recoveredNames.some(name => input.candidates.some(c => c.name === name) ||
    clauses.some(clause => clause.includes(name) && !/(?:未確認|確認でき|対象外|候補から外)/u.test(clause)));
  return { passed: input.completed && !forbiddenRecommendation && !promotedUnresolved,
    forbiddenRecommendation, promotedUnresolved, recovery, completed: input.completed };
}
