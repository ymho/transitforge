import { expect, it } from "vitest";
import { strandsFailureDiagnostic } from "./strands-failure-diagnostic.js";

it("retains network causes and bounded AWS metadata without exception content", () => {
  const cause = Object.assign(new Error("private credentials and conversation"), { code: "ECONNRESET", $metadata: { httpStatusCode: 503, attempts: 3, totalRetryDelay: 450, requestId: "private-request" } });
  const error = new Error("private prompt", { cause });
  expect(strandsFailureDiagnostic(error)).toEqual({ errorName: "Error", cause1Name: "Error", cause1Code: "ECONNRESET", cause1httpStatusCode: 503, cause1attempts: 3, cause1totalRetryDelay: 450 });
  expect(JSON.stringify(strandsFailureDiagnostic(error))).not.toContain("private");
});

it("never serializes arbitrary names, codes, metadata or cyclic causes", () => {
  const error: Record<string, unknown> = { name: "private-user", code: "private-token", message: "private-message", $metadata: { httpStatusCode: 999, attempts: -1, totalRetryDelay: Infinity } };
  error.cause = error;
  expect(strandsFailureDiagnostic(error)).toEqual({ errorName: "unclassified" });
  expect(strandsFailureDiagnostic("private-provider-message")).toEqual({ errorName: "unclassified" });
});

it("retains only a numeric throw site in the known Lambda bundle", () => {
  expect(strandsFailureDiagnostic({ name: "Error", stack: "Error: private-secret\n    at run (/var/task/index.cjs:45678:19)\n    at privateUser (/private/file:99:1)" })).toEqual({ errorName: "Error", errorBundleLine: 45678, errorBundleColumn: 19 });
});
