import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { outputContract, stableContractHash } from "./output-contract";

describe("OutputContract", () => {
  it("uses canonical SHA-256 and stable name/version identity", () => {
    const expected = createHash("sha256").update('{"a":2,"b":1}').digest("hex");
    expect(stableContractHash({ b: 1, a: 2 })).toBe(expected);
    expect(outputContract("agent_turn", "1", { b: 1, a: 2 })).toMatchObject({ name: "agent_turn", version: "1", schemaHash: expected });
  });
});
