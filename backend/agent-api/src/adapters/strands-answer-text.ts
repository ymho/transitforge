export class StrandsAnswerTextError extends Error {
  constructor(readonly code: "missing_text" | "unsupported_block" | "internal_content" | "text_budget") {
    super(`Agent v2 answer text rejected: ${code}`);
    this.name = "StrandsAnswerTextError";
  }
}

/** Text candidate, not a statement of factual correctness or permission to publish. */
export function strandsAnswerText(result: { lastMessage?: unknown }): string {
  const message = record(result.lastMessage);
  if (message?.role !== "assistant" || !Array.isArray(message.content)) {
    throw new StrandsAnswerTextError("missing_text");
  }
  const parts: string[] = [];
  for (const value of message.content) {
    const block = record(value);
    if (block?.type === "reasoningBlock") continue;
    if (block?.type !== "textBlock" || typeof block.text !== "string") {
      // Tool/citation/interrupt payloads require their own Application adapters.
      throw new StrandsAnswerTextError("unsupported_block");
    }
    parts.push(block.text);
  }
  const text = parts.join("\n");
  if (!text.trim()) throw new StrandsAnswerTextError("missing_text");
  if (text.length > 12_000) throw new StrandsAnswerTextError("text_budget");
  // Some providers emit thought markup in ordinary text instead of a typed block.
  // Reject the whole candidate; do not strip it and pretend the rest was admitted.
  if (/<\/?(?:thinking|analysis|reasoning)\b|💭\s*Reasoning\s*:/iu.test(text)) {
    throw new StrandsAnswerTextError("internal_content");
  }
  return text;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}
