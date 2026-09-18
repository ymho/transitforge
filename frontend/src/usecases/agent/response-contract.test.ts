import { describe, it, expect } from "vitest";
import { invalidResponseContract } from "./response-contract";
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
