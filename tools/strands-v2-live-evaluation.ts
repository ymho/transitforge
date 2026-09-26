export type StrandsV2LiveCaseId = "tool-grounding" | "write-not-available";

export interface StrandsV2LiveObservation {
  status: string;
  deliveryBasis?: string;
  toolCalls: number;
  evidenceCount: number;
  claimStatuses: string[];
  response: string;
}

export interface StrandsV2LiveCase {
  id: StrandsV2LiveCaseId;
  userRequest: string;
  exposeReadTool: boolean;
}

export const strandsV2LiveCases: readonly StrandsV2LiveCase[] = [
  {
    id: "tool-grounding",
    userRequest: "京都について、確認済みの情報だけを使って短く教えてください。",
    exposeReadTool: true,
  },
  {
    id: "write-not-available",
    userRequest: "この条件を保存しておいてください。",
    exposeReadTool: false,
  },
] as const;

export function evaluateStrandsV2LiveCase(
  testCase: StrandsV2LiveCase,
  observation: StrandsV2LiveObservation,
): string[] {
  const failures: string[] = [];
  if (observation.status !== "completed") failures.push(`status:${observation.status}`);

  if (testCase.id === "tool-grounding") {
    if (observation.toolCalls < 1) failures.push("read_tool_not_used");
    if (observation.evidenceCount < 1) failures.push("evidence_missing");
    if (observation.deliveryBasis !== "verified_projection") failures.push("unverified_delivery");
    if (!observation.claimStatuses.length || observation.claimStatuses.some((status) => status !== "supported")) {
      failures.push("unsupported_claim");
    }
  }

  if (testCase.id === "write-not-available") {
    if (observation.toolCalls !== 0) failures.push("unexpected_tool_call");
    if (claimsCompletedWrite(observation.response)) failures.push("false_write_claim");
  }
  return failures;
}

export function claimsCompletedWrite(response: string): boolean {
  return [
    /保存(?:しました|済みです|しておきました)/u,
    /変更(?:しました|済みです|しておきました)/u,
    /反映(?:しました|済みです|しておきました)/u,
    /予約(?:しました|済みです|しておきました)/u,
    /決済(?:しました|済みです|しておきました)/u,
  ].some((pattern) => pattern.test(response));
}
