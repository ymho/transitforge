import { createHash } from "node:crypto";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import type { JwksCache } from "aws-jwt-verify/jwk";
import { AuthenticationError, type TrustedPrincipal } from "../contracts/trusted-principal.js";
import type { AccessTokenVerifier } from "../ports/access-token-verifier.js";

/** Create once per server composition, so the library's JWKS cache survives requests. */
export function createCognitoAccessTokenVerifier(config: {
  userPoolId: string;
  clientId: string;
}, infrastructure: { jwksCache?: JwksCache } = {}): AccessTokenVerifier {
  if (!config.clientId.trim()) throw new Error("Cognito clientId is required");
  const verifier = CognitoJwtVerifier.create({
    userPoolId: config.userPoolId, clientId: config.clientId, tokenUse: "access",
    customJwtCheck: ({ header, payload }) => {
      if (header.alg !== "RS256" || !Number.isFinite(payload.exp) ||
          payload.exp! <= Date.now() / 1000 || typeof payload.sub !== "string" ||
          !payload.sub.trim() || payload.sub.length > 200 || /[\u0000-\u001f\u007f]/.test(payload.sub)) {
        throw new AuthenticationError("unauthenticated");
      }
    },
  }, infrastructure.jwksCache ? { jwksCache: infrastructure.jwksCache } : undefined);
  return {
    async verify(accessToken): Promise<TrustedPrincipal> {
      try {
        if (typeof accessToken !== "string" || !accessToken || accessToken.length > 16384) {
          throw new AuthenticationError("unauthenticated");
        }
        const claims = await verifier.verify(accessToken);
        // Stable encoding into the EXISTING TripPrincipal.subject, bounded to its 200-char limit.
        const subject = "identity-v1:" + createHash("sha256")
          .update(JSON.stringify([claims.iss, claims.sub]), "utf8").digest("hex");
        return Object.freeze({ subject,
          identity: Object.freeze({ issuer: claims.iss, subject: claims.sub }),
          scopes: Object.freeze((claims.scope ?? "").split(" ").filter(Boolean)),
        });
      } catch {
        // Fail closed on invalid tokens AND unavailable JWKS; provider errors may contain claims.
        throw new AuthenticationError("unauthenticated");
      }
    },
  };
}
