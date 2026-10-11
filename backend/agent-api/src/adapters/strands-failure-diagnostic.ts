const names = new Set(["Error", "ModelError", "ModelThrottledError", "MaxTokensError", "TypeError", "AbortError", "TimeoutError", "CancelledError", "ContextWindowOverflowError", "StructuredOutputError", "ValidationException", "AccessDeniedException", "ThrottlingException", "ServiceUnavailableException", "InternalServerException", "ModelTimeoutException", "ModelErrorException", "ModelNotReadyException", "ResourceNotFoundException", "CredentialsProviderError"]);
const codes = new Set(["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EPIPE", "ERR_HTTP2_STREAM_CANCEL", "ERR_HTTP2_STREAM_ERROR", "ERR_HTTP2_INVALID_SESSION"]);
/** Do not retain messages, stacks, request IDs, headers, endpoints or arbitrary error strings. */
export function strandsFailureDiagnostic(error: unknown): Record<string, string | number> {
  const result: Record<string, string | number> = {};
  const seen = new Set<unknown>();
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object" && !seen.has(current); depth++) {
    seen.add(current);
    const value = current as Record<string, unknown>;
    const prefix = depth === 0 ? "error" : `cause${depth}`;
    result[`${prefix}Name`] = typeof value.name === "string" && names.has(value.name) ? value.name : "unclassified";
    if (typeof value.code === "string" && codes.has(value.code)) result[`${prefix}Code`] = value.code;
    // A numeric location in the known Lambda bundle can identify the throw site
    // without storing a stack or its private message/path fragments.
    const frame = typeof value.stack === "string" ? /(?:^|\n)\s+at [^\n]*\/var\/task\/index\.cjs:(\d{1,6}):(\d{1,6})/u.exec(value.stack) : null;
    if (frame) { result[`${prefix}BundleLine`] = Number(frame[1]); result[`${prefix}BundleColumn`] = Number(frame[2]); }
    const metadata = value.$metadata;
    if (metadata && typeof metadata === "object") {
      const fields = metadata as Record<string, unknown>;
      for (const [field, minimum, maximum] of [["httpStatusCode", 100, 599], ["attempts", 1, 10], ["totalRetryDelay", 0, 180_000]] as const) {
        const number = fields[field];
        if (typeof number === "number" && Number.isSafeInteger(number) && number >= minimum && number <= maximum) result[`${prefix}${field}`] = number;
      }
    }
    current = value.cause;
  }
  if (!Object.keys(result).length) result.errorName = "unclassified";
  return result;
}
