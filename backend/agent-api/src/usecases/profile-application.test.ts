import { expect, it } from "vitest";
import { ProfileApplication } from "./profile-application.js";
import { stateDynamoFixture, stateA, stateProfile } from "../adapters/state-dynamodb.fixture.js";

it("Profile Application stamps server time without changing the existing Domain model", async () => {
  const f = stateDynamoFixture(), app = new ProfileApplication(f.profiles, f.clock), input = stateProfile();
  const saved = await app.update(stateA, input, null);
  expect(saved.profile).toEqual({ ...input, updatedAt: f.clock.now().toISOString() });
  expect(input.updatedAt).toBe("2026-09-18T00:00:00.000Z");
  expect(await app.get(stateA)).toEqual(saved);
  await app.delete(stateA, saved.revision);
  expect(await app.get(stateA)).toBeUndefined();
});
