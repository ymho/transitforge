import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { agentV2AcceptanceCatalog } from "./agent-v2-acceptance-catalog.js";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");

describe("Agent v2 greenfield acceptance catalog", () => {
  it("binds every active invariant to an executable test without using V1 runtime tests as the oracle", () => {
    const active = agentV2AcceptanceCatalog.filter(({ kind }) => kind !== "deferred");
    expect(active.length).toBeGreaterThanOrEqual(10);
    expect(new Set(agentV2AcceptanceCatalog.map(({ id }) => id)).size).toBe(agentV2AcceptanceCatalog.length);

    for (const entry of active) {
      expect(entry.testFile, entry.id).toBeTruthy();
      expect(entry.testName, entry.id).toBeTruthy();
      expect(entry.testFile, entry.id).not.toBe("modules/agent/runtime/agent-runtime.test.ts");
      expect(entry.testFile, entry.id).not.toBe("modules/agent/runtime/research-runtime-enforcement.test.ts");

      const source = readFileSync(resolve(repositoryRoot, entry.testFile!), "utf8");
      expect(source, `${entry.id}: missing test file marker`).toContain(entry.testName!);
      expect(source, `${entry.id}: V2 gate must not instantiate MultiStepAgentRuntime`)
        .not.toContain("new MultiStepAgentRuntime");
    }
  });

  it("keeps intentionally unfinished write/clarification behavior explicit instead of borrowing V1 guards", () => {
    const deferred = agentV2AcceptanceCatalog.filter(({ kind }) => kind === "deferred");
    expect(deferred.map(({ id }) => id)).toEqual([
      "V2-CLARIFICATION-01",
      "V2-CURRENTNESS-01",
      "V2-WRITE-01",
    ]);
    expect(deferred.every(({ reason }) => Boolean(reason?.trim()))).toBe(true);
  });

  it("keeps the dedicated v2 test command independent from V1 runtime suites", () => {
    const packageJson = JSON.parse(readFileSync(resolve(repositoryRoot, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const command = packageJson.scripts?.["test:agent:v2"] ?? "";
    expect(command).toContain("strands-agent-engine.test.ts");
    expect(command).toContain("agent-v2-acceptance-catalog.test.ts");
    expect(command).not.toContain("agent-runtime.test.ts");
    expect(command).not.toContain("research-runtime-enforcement.test.ts");
  });
});
