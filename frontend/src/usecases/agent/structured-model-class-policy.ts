import type { AgentModelClassPolicy } from "./agent-runtime";

/**
 * 複雑な既存旅程判断と結果駆動再計画だけをdecision classへ送る候補policy。
 * 発話本文、目的地、Tool名は見ず、追加のmodel callも行わない。
 */
export const structuredModelClassPolicy: AgentModelClassPolicy = ({ request, phase }) =>
  phase === "result_driven_replan" || request.context?.currentJourney !== undefined
    ? "decision"
    : undefined;
