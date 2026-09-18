import { describe, it, expect } from "vitest";
import { invalidResponseContract } from "./response-contract";
import { validateEvidenceAndClaims, type Evidence } from "./evidence-model";
import type { AgentModelResponse } from "./model-provider";
const response = (text: string): AgentModelResponse => ({ message: {role:"assistant",content:[{type:"text",text}]},stopReason:"completed",metadata:{provider:"test"} });
describe("response wire contract", () => {
  it.each(['<tool_call>{"secret":"private"}</tool_call>', '<ask_follow_up>', '{"name":"search_direct_routes","input":', 'search_direct_routes {"origin":"A"}'])('rejects without executing %s', text => {
    expect(invalidResponseContract(response(text), ['search_direct_routes'])).toBe('tool_text_envelope');
  });
  it.each(['こんにちは', 'JSON例: {"name":"太郎"}', '```xml\n<tool_call>例</tool_call>\n```'])('allows ordinary explanation %s', text => {
    expect(invalidResponseContract(response(text), ['search_direct_routes'])).toBeUndefined();
  });
});
describe("typed Claim binding", () => {
  const e: Evidence = {id:'route',category:'journey',knowledgeKind:'deterministic_fact',subject:'京都→大阪',facts:{date:'2026-09-18',duration:30},references:[{sourceType:'timetable-index',sourceRef:'index',retrievedAt:null,freshness:'scheduled',summary:'時刻表'}]};
  it.each([
    ['京都→大阪',{date:'2026-09-18',duration:30},true],
    ['東京→大阪',{date:'2026-09-18',duration:30},false],
    ['京都→大阪',{date:'2026-09-19',duration:30},false],
    ['京都→大阪',{date:'2026-09-18',duration:10},false],
  ] as const)('validates subject and exact facts %s', (subject,facts,valid)=>{
    expect(validateEvidenceAndClaims([e],[{id:'claim',kind:'fact',statement:'計画所要時間',evidenceIds:['route'],binding:{subject,facts}}]).valid).toBe(valid);
  });
});
