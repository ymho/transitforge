import { describe, expect, it, vi } from "vitest";
import { cognitoTokenFixture as fixture, token, key, rotated, issuer, scope, jwk } from "./cognito-token.fixture.js";
import { SimpleJwksCache } from "aws-jwt-verify/jwk";
import { createTrip } from "@raiquora/trip/trip";
import { createCognitoAccessTokenVerifier } from "./cognito-access-token-verifier.js";
import { authenticatedApplication } from "../usecases/authenticated-application.js";
import { TripApplication } from "../usecases/trip-application.js";
import { tripDynamoFixture } from "./trip-dynamodb.fixture.js";


describe("Cognito authentication boundary", () => {
  it("validates signed access tokens, caches JWKS and ignores forged identity claims/input", async () => {
    const { verifier, fetch } = fixture();
    const principal = await verifier.verify(token({ ownerId: "forged", userId: "forged", email: "forged@example.invalid" }));
    expect(principal.identity).toEqual({ issuer, subject: "user-a" });
    expect(principal.subject).toBe("identity-v1:65157c794cbdcefee9188cec1b1910abe6d27387ee3f898243f42f462be50827");
    expect(await verifier.verify(token())).toEqual(principal);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(`${issuer}/.well-known/jwks.json`);
    const execute = vi.fn(async (p, _input) => p);
    const run = authenticatedApplication(verifier, [scope], execute);
    expect(await run(token(), { ownerId: "forged", userId: "forged", principal: { subject: "forged" } })).toEqual(principal);
    expect(execute.mock.calls[0]![0].subject).not.toBe("forged");
  });
  it.each([
    ["expired", { exp: 1 }], ["missing expiry", { exp: undefined }],
    ["wrong issuer", { iss: issuer + "Other" }], ["wrong client", { client_id: "other" }],
    ["ID Token", { token_use: "id", aud: "app-client" }], ["missing subject", { sub: undefined }],
    ["empty subject", { sub: "" }], ["future token", { nbf: 9999999999 }],
  ])("rejects %s before business work", async (_label, changes) => {
    const { verifier } = fixture(), execute = vi.fn();
    await expect(authenticatedApplication(verifier, [scope], execute)(token(changes), {})).rejects.toMatchObject({ code: "unauthenticated" });
    expect(execute).not.toHaveBeenCalled();
  });
  it("rejects malformed, missing and forged signatures without retaining token details", async () => {
    const { verifier } = fixture(), execute = vi.fn(), run = authenticatedApplication(verifier, [scope], execute);
    for (const value of [undefined, "not-a-jwt", token({}, rotated)]) {
      const error = await run(value, {}).catch((error: Error) => error);
      expect(error).toMatchObject({ message: "unauthenticated", code: "unauthenticated" });
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).cause).toBeUndefined();
    }
    expect(execute).not.toHaveBeenCalled();
  });
  it("requires ALL composition scopes, after authentication, before side effects", async () => {
    const { verifier } = fixture(), execute = vi.fn();
    const run = authenticatedApplication(verifier, [scope, "raiquora/write"], execute);
    await expect(run(token(), {})).rejects.toMatchObject({ code: "forbidden" });
    await expect(run(token({ scope: undefined }), {})).rejects.toMatchObject({ code: "forbidden" });
    expect(execute).not.toHaveBeenCalled();
    await run(token({ scope: `${scope} raiquora/write` }), {});
    expect(execute).toHaveBeenCalledOnce();
    expect(() => authenticatedApplication(verifier, [], execute)).toThrow();
  });
  it("refreshes on rotated kid and fails closed on missing keys/JWKS outage", async () => {
    const { verifier, fetch } = fixture();
    await verifier.verify(token());
    fetch.mockResolvedValueOnce(new TextEncoder().encode(JSON.stringify({ keys: [jwk(rotated, "key-2")] })).buffer);
    await verifier.verify(token({}, rotated, "key-2"));
    expect(fetch).toHaveBeenCalledTimes(2);
    fetch.mockRejectedValueOnce(new Error("private infrastructure error"));
    await expect(verifier.verify(token({}, key, "key-3"))).rejects.toThrow("unauthenticated");
    await expect(verifier.verify(token({}, key, "unknown"))).rejects.toThrow("unauthenticated");
    const before = fetch.mock.calls.length;
    await expect(verifier.verify(token({}, key, "unknown-again"))).rejects.toThrow("unauthenticated");
    expect(fetch).toHaveBeenCalledTimes(before); // library penalty box limits unknown-kid refetches
  });
  it("passes the same subject into existing Trip Application/Repository and isolates accounts", async () => {
    const { verifier } = fixture(), f = tripDynamoFixture();
    const app = new TripApplication(f.repository, f.repository, f.clock);
    const run = authenticatedApplication(verifier, [scope], (principal, input) => app.execute(principal, input));
    const trip = createTrip("11111111-1111-4111-8111-111111111111", "Test", "2026-09-13T01:00:00Z");
    await run(token(), { version: "trip-api-v1", operation: "create", trip });
    const principal = await verifier.verify(token());
    expect(await f.repository.get({ subject: principal.subject }, trip.id)).toEqual(trip);
    await expect(run(token({ sub: "user-b" }), { version: "trip-api-v1", operation: "get", tripId: trip.id })).rejects.toMatchObject({ code: "not-found" });
    for (const field of ["ownerId", "userId", "email"]) {
      await expect(run(token(), { version: "trip-api-v1", operation: "list", [field]: "forged" })).rejects.toMatchObject({ code: "invalid-input" });
    }
    const otherPool = "ap-northeast-1_OtherPool";
    const otherIssuer = `https://cognito-idp.ap-northeast-1.amazonaws.com/${otherPool}`;
    const cache = new SimpleJwksCache(); cache.addJwks(`${otherIssuer}/.well-known/jwks.json`, { keys: [jwk()] });
    const other = createCognitoAccessTokenVerifier({ userPoolId: otherPool, clientId: "app-client" }, { jwksCache: cache });
    expect((await other.verify(token({ iss: otherIssuer }))).subject).not.toBe(principal.subject);
  });
});
