import { describe, expect, it } from "vitest";
import { stateDynamoFixture, stateA as a, stateB as b, stateProfile } from "./state-dynamodb.fixture.js";

describe("Profile V3 persistence", () => {
  it("preserves only the three Profile concepts and clones input", async () => {
    const f = stateDynamoFixture(), input = stateProfile();
    const saved = await f.profiles.put(a, input, null); input.usualOrigin = "変更";
    expect(await f.profiles.get(a)).toEqual(saved);
    expect(saved.profile).toEqual(stateProfile());
    await expect(f.profiles.put(a, input, null)).rejects.toMatchObject({ code: "conflict" });
    expect((await f.profiles.put(a, input, 0)).revision).toBe(1);
  });
  it("isolates reads, writes and deletes per principal", async () => {
    const f = stateDynamoFixture(); await f.profiles.put(a, stateProfile(), null);
    expect(await f.profiles.get(b)).toBeUndefined();
    await expect(f.profiles.put(b, stateProfile(), 0)).rejects.toMatchObject({ code: "not-found" });
    await f.profiles.put(b, { ...stateProfile(), usualOrigin: "B" }, null);
    await f.profiles.delete(b, 0);
    expect((await f.profiles.get(a))?.profile).toEqual(stateProfile());
  });
  it("prevents racing edits/deletes and ABA after delete/recreate", async () => {
    const f = stateDynamoFixture(); await f.profiles.put(a, stateProfile(), null);
    f.faults.beforeWrite = async () => { await f.profiles.put(a, { ...stateProfile(), usualOrigin: "更新" }, 0); };
    await expect(f.profiles.delete(a, 0)).rejects.toMatchObject({ code: "conflict" });
    await f.profiles.delete(a, 1); expect(await f.profiles.get(a)).toBeUndefined();
    expect([...f.records.values()][0]).not.toHaveProperty("payload");
    expect((await f.profiles.put(a, stateProfile(), null)).revision).toBe(3);
    await expect(f.profiles.put(a, stateProfile(), 0)).rejects.toMatchObject({ code: "conflict" });
  });
  it("rejects old schema, forged owners, oversized text and missing principals", async () => {
    const f = stateDynamoFixture();
    for (const profile of [{ ...stateProfile(), ownerId: a.subject }, { ...stateProfile(), version: 2 },
      { ...stateProfile(), considerations: "x".repeat(2000) }]) {
      await expect(f.profiles.put(a, profile as never, null)).rejects.toMatchObject({ code: "invalid-input" });
    }
    await expect(f.profiles.get(undefined as never)).rejects.toMatchObject({ code: "unauthenticated" });
    expect(f.commands).toHaveLength(0);
  });
  it("does not silently replace invalid saved profile data", async () => {
    const f = stateDynamoFixture(); await f.profiles.put(a, stateProfile(), null);
    [...f.records.values()][0].payload = { S: '{"version":99}' };
    await expect(f.profiles.get(a)).rejects.toMatchObject({ code: "unavailable" });
    await expect(f.profiles.put(a, stateProfile(), 0)).rejects.toMatchObject({ code: "unavailable" });
  });
});
