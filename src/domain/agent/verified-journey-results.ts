import type { JourneySearchResponse } from "../journey-search-service";
import type { VerifiedJourneySearchResultSource } from "./compare-journeys-tool";
import type { VerifiedJourneySearchResultWriter } from "./search-journeys-tool";

export class VerifiedJourneySearchResultStore
  implements VerifiedJourneySearchResultSource, VerifiedJourneySearchResultWriter {
  private readonly byExecution = new Map<string, Map<string, JourneySearchResponse>>();

  constructor(
    private readonly maximumResultsPerExecution = 4,
    private readonly maximumExecutions = 16,
  ) {
    if (maximumResultsPerExecution < 1 || maximumExecutions < 1) {
      throw new Error("検証済み経路検索結果の上限は1件以上にしてください");
    }
  }

  save(executionId: string, result: JourneySearchResponse): string {
    let results = this.byExecution.get(executionId);
    if (!results) {
      if (this.byExecution.size >= this.maximumExecutions) {
        const oldestExecutionId = this.byExecution.keys().next().value;
        if (oldestExecutionId !== undefined) this.byExecution.delete(oldestExecutionId);
      }
      results = new Map();
      this.byExecution.set(executionId, results);
    }
    if (results.size >= this.maximumResultsPerExecution) {
      throw new Error("同じAgent実行で保持できる経路検索結果の上限を超えました");
    }
    const resultId = `journey-search-${results.size + 1}`;
    results.set(resultId, structuredClone(result));
    return resultId;
  }

  async resolve(
    executionId: string,
    searchResultId: string,
  ): Promise<JourneySearchResponse | undefined> {
    const result = this.byExecution.get(executionId)?.get(searchResultId);
    return result === undefined ? undefined : structuredClone(result);
  }

  clear(executionId: string): void {
    this.byExecution.delete(executionId);
  }
}
