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
    clauses.some((clause, index) => {
      if (!fixture.forbiddenNames.some(n => clause.includes(n))) return false;
      if (positiveRecommendation(clause)) return true;
      if (rejection(clause)) return false;
      // Neutral search-hit reporting followed immediately by an explicit anaphoric
      // rejection is a safe explanation, not a recommendation. A positive claim
      // above can never be excused by a later unrelated uncertainty sentence.
      const next = clauses[index + 1]?.trim() ?? "";
      return !(/(?:検索結果|検索で).*(?:ヒット|見つか|含ま|出て)/u.test(clause) &&
        /^(?:これ|この結果|この候補|同候補)/u.test(next) && rejection(next) && !positiveRecommendation(next));
    });
  const promotedUnresolved = input.candidates.some(c => c.targetBinding && c.targetBinding.status !== "resolved");
  const recovery = fixture.recoveredNames.some(name => input.candidates.some(c => c.name === name) ||
    clauses.some(clause => clause.includes(name) && !/(?:未確認|確認でき|対象外|候補から外)/u.test(clause)));
  return { passed: input.completed && !forbiddenRecommendation && !promotedUnresolved,
    forbiddenRecommendation, promotedUnresolved, recovery, completed: input.completed };
}

function rejection(clause: string): boolean {
  return /(?:候補から外|対象外|近場では|遠方|遠く|別地域|条件には?合(?:わ|いません)|適合しない|推薦しません|おすすめしません|未確認|確認でき|除外)/u.test(clause);
}
function positiveRecommendation(clause: string): boolean {
  return /(?:おすすめ|推薦|候補にします|訪れましょう)/u.test(clause.replace(/(?:おすすめ|推薦)しません/gu, ""));
}
