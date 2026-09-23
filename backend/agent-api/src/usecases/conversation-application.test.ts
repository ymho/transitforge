import { describe, expect, it } from "vitest";
import { createTrip } from "@raiquora/trip/trip";
import { ConversationApplication } from "./conversation-application.js";
import { ProfileApplication } from "./profile-application.js";
import { authenticatedApplication } from "./authenticated-application.js";
import { cognitoTokenFixture, token, scope } from "../adapters/cognito-token.fixture.js";
import { tripDynamoFixture } from "../adapters/trip-dynamodb.fixture.js";
import { stateDynamoFixture, stateA, conversationId as id, secondId, stateMetadata, stateProfile, noCandidateResources } from "../adapters/state-dynamodb.fixture.js";

describe("verified principal → applications → DynamoDB", () => {
  it("uses #484 identity for all account isolation and rejects forged owner input", async () => {
    const auth = cognitoTokenFixture(), f = stateDynamoFixture();
    const a = await auth.verifier.verify(token()), b = await auth.verifier.verify(token({ sub: "user-b" }));
    const conversations = new ConversationApplication(f.conversations, noCandidateResources, () => id), profiles = new ProfileApplication(f.profiles, f.clock);
    const create = authenticatedApplication(auth.verifier, [scope], (principal, input: unknown) => conversations.create(principal, input));
    const saved = await create(token(), stateMetadata());
    expect(saved.ownerSubject).toBe(a.subject);
    expect([...f.records.values()][0].pk.S).toBe(`OWNER#${a.subject}`);
    await conversations.append(a, id, 0, [{ role: "user", text: "相談" }]);
    for (const target of [id, secondId]) {
      await expect(conversations.get(b, target)).rejects.toMatchObject({ code: "not-found", message: "not-found" });
      await expect(conversations.history(b, target)).rejects.toMatchObject({ code: "not-found" });
      await expect(conversations.update(b, target, 1, stateMetadata())).rejects.toMatchObject({ code: "not-found" });
      await expect(conversations.append(b, target, 1, [{ role: "assistant", text: "攻撃" }])).rejects.toMatchObject({ code: "not-found" });
      await expect(conversations.delete(b, target, 1)).rejects.toMatchObject({ code: "not-found" });
    }
    expect((await conversations.list(b)).items).toEqual([]);
    for (const forged of [{ ownerId: a.subject }, { userId: a.identity.subject }, { principal: a }]) {
      await expect(create(token({ sub: "user-b" }), { ...stateMetadata(), ...forged })).rejects.toMatchObject({ code: "invalid-input" });
      await expect(conversations.update(b, id, 1, { ...stateMetadata(), ...forged })).rejects.toMatchObject({ code: "invalid-input" });
      await expect(profiles.update(b, { ...stateProfile(), ...forged }, null)).rejects.toMatchObject({ code: "invalid-input" });
    }
    await profiles.update(a, stateProfile(), null);
    expect(await profiles.get(b)).toBeUndefined();
    await expect(profiles.update(b, stateProfile(), 0)).rejects.toMatchObject({ code: "not-found" });
    await expect(profiles.delete(b, 0)).rejects.toMatchObject({ code: "not-found" });
    await profiles.update(b, { ...stateProfile(), notes: { food: "Bのメモ" } }, null);
    expect((await profiles.get(a))?.profile.notes).toEqual(stateProfile().notes);
    await profiles.delete(b, 0);
    expect(await profiles.get(a)).toBeDefined();
  });
  it("does not enter storage on invalid token or missing scope", async () => {
    const auth = cognitoTokenFixture(), f = stateDynamoFixture(), app = new ConversationApplication(f.conversations, noCandidateResources);
    const create = authenticatedApplication(auth.verifier, [scope], (p, input: unknown) => app.create(p, input));
    for (const accessToken of [undefined, "forged", token({ exp: 1 })]) await expect(create(accessToken, stateMetadata())).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(create(token({ scope: "unrelated" }), stateMetadata())).rejects.toMatchObject({ code: "forbidden" });
    expect(f.commands).toHaveLength(0);
  });
  it("conversation deletion and profile changes never modify the referenced Trip", async () => {
    const auth = cognitoTokenFixture(), principal = await auth.verifier.verify(token()), f = stateDynamoFixture(), trips = tripDynamoFixture();
    const trip = createTrip(secondId, "独立した旅程", "2026-09-18T00:00:00Z");
    await trips.repository.create(principal, trip);
    const original = structuredClone(trips.records), commandCount = trips.commands.length;
    const app = new ConversationApplication(f.conversations, noCandidateResources, () => id), profile = new ProfileApplication(f.profiles, f.clock);
    await app.create(principal, stateMetadata());
    await profile.update(principal, stateProfile(), null);
    await profile.update(principal, { ...stateProfile(), preferences: { mountain: 1 } }, 0);
    await profile.delete(principal, 1);
    await app.delete(principal, id, 0);
    expect(trips.records).toEqual(original);
    expect(trips.commands).toHaveLength(commandCount);
  });
  it("reports deletion complete only after cross-table candidate cleanup and resumes from the tombstone", async () => {
    const f = stateDynamoFixture(); let attempts = 0;
    const candidates = { purgeConversation: async (principal: { subject: string }, conversationId: string) => {
      expect(principal.subject).toBe(stateA.subject); expect(conversationId).toBe(id); attempts++;
      if (attempts === 1) throw Object.assign(new Error("candidate table unavailable"), { code: "unavailable" });
      return { complete: attempts >= 3 };
    } };
    const app = new ConversationApplication(f.conversations, candidates, () => id);
    await app.create(stateA, stateMetadata());
    await expect(app.delete(stateA, id, 0)).rejects.toMatchObject({ code: "unavailable" });
    expect(await f.conversations.get(stateA, id)).toBeUndefined();
    expect(await app.delete(stateA, id, 0)).toEqual({ complete: false });
    expect(await app.delete(stateA, id, 0)).toEqual({ complete: true });
  });
});
