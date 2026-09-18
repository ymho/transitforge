import { generateKeyPairSync, sign } from "node:crypto";
import { vi } from "vitest";
import { SimpleJwksCache } from "aws-jwt-verify/jwk";
import { createCognitoAccessTokenVerifier } from "./cognito-access-token-verifier.js";

// Ephemeral local signing keys only. No Cognito credentials, saved tokens or network.
export const key = generateKeyPairSync("rsa", { modulusLength: 2048 });
export const rotated = generateKeyPairSync("rsa", { modulusLength: 2048 });
export const pool = "ap-northeast-1_TestPool", issuer = `https://cognito-idp.ap-northeast-1.amazonaws.com/${pool}`;
export const scope = "raiquora/user";
export const jwk = (pair = key, kid = "key-1") => ({ ...pair.publicKey.export({ format: "jwk" }), kty: "RSA", kid, alg: "RS256", use: "sig" });
export function token(changes: Record<string, unknown> = {}, pair = key, kid = "key-1") {
  const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const data = `${encode({ alg: "RS256", kid })}.${encode({ iss: issuer, sub: "user-a", client_id: "app-client", token_use: "access", exp: Math.floor(Date.now() / 1000) + 300, scope, ...changes })}`;
  return `${data}.${sign("RSA-SHA256", Buffer.from(data), pair.privateKey).toString("base64url")}`;
}
export function cognitoTokenFixture() {
  const fetch = vi.fn(async (_uri: string): Promise<ArrayBuffer> => new TextEncoder().encode(JSON.stringify({ keys: [jwk()] })).buffer);
  const cache = new SimpleJwksCache({ fetcher: { fetch } });
  const verifier = createCognitoAccessTokenVerifier({ userPoolId: pool, clientId: "app-client" }, { jwksCache: cache });
  return { verifier, fetch };
}
