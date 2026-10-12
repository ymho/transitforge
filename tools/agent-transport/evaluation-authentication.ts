import { OidcClient, InMemoryWebStorage, WebStorageStateStore, ErrorResponse, type SigninResponse } from "oidc-client-ts";
import { randomUUID } from "node:crypto";
import { parseAuthConfig } from "../../frontend/src/adapters/auth/auth-config.js";
import { createCognitoAccessTokenVerifier } from "../../backend/agent-api/src/adapters/cognito-access-token-verifier.js";
import type { AccessTokenVerifier } from "../../backend/agent-api/src/ports/access-token-verifier.js";

type Client = Pick<OidcClient, "createSigninRequest" | "processSigninResponse" | "useRefreshToken" | "revokeToken">;
export interface EvaluationAuthentication {
  begin(): Promise<string>;
  complete(callback: string): Promise<void>;
  token(): Promise<string>;
  close(): Promise<void>;
}

/** A native test client's normal user grant, not a password/M2M bypass. All
 * credentials and PKCE state remain in this process; nothing is exported. */
export function createEvaluationAuthentication(input: {
  config: unknown; callback: string; expectedSubject: string;
}, dependencies: { client?: Client; verifier?: AccessTokenVerifier; now?: () => number } = {}): EvaluationAuthentication {
  const callback = new URL(input.callback);
  if (callback.href !== "http://127.0.0.1:8788/index.html" || !input.expectedSubject.trim() || input.expectedSubject.length > 200) throw new Error("invalid_evaluation_auth_config");
  const config = parseAuthConfig(input.config, callback.origin);
  const issuer = new URL(config.issuer);
  const pool = issuer.pathname.slice(1);
  if (!/^https:\/\/cognito-idp\.ap-northeast-1\.amazonaws\.com\/ap-northeast-1_[A-Za-z0-9]+$/u.test(config.issuer) || !config.scopes.includes("raiquora/user")) throw new Error("invalid_evaluation_auth_config");
  const client = dependencies.client ?? new OidcClient({ authority: config.issuer, client_id: config.clientId,
    redirect_uri: callback.href, response_type: "code", response_mode: "query", scope: config.scopes.join(" "),
    loadUserInfo: false, filterProtocolClaims: false, staleStateAgeInSeconds: 600, requestTimeoutInSeconds: 15,
    fetchRequestCredentials: "omit", stateStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
    metadata: { issuer: config.issuer, authorization_endpoint: `${config.loginOrigin}/oauth2/authorize`,
      token_endpoint: `${config.loginOrigin}/oauth2/token`, revocation_endpoint: `${config.loginOrigin}/oauth2/revoke` } });
  const verifier = dependencies.verifier ?? createCognitoAccessTokenVerifier({ userPoolId: pool, clientId: config.clientId });
  const now = dependencies.now ?? Date.now;
  let session: { response: SigninResponse; expiresAt: number; absoluteExpiresAt: number } | undefined;
  let revocationToken: string | undefined;
  let begunAt: number | undefined, closed = false, refreshing: Promise<string> | undefined, completing: Promise<void> | undefined;
  async function validate(response: SigninResponse) {
    const principal = await verifier.verify(response.access_token);
    if (principal.identity.subject !== input.expectedSubject || principal.identity.issuer !== config.issuer || !principal.scopes.includes("raiquora/user") ||
      !response.access_token || !response.refresh_token || response.token_type?.toLowerCase() !== "bearer" ||
      !Number.isInteger(response.expires_in) || response.expires_in! < 1 || response.expires_in! > 300 ||
      response.profile.iss !== config.issuer || response.profile.aud !== config.clientId || response.profile.sub !== input.expectedSubject)
      throw new Error("evaluation_auth_rejected");
    return response;
  }
  return {
    async begin() {
      if (closed || begunAt !== undefined) throw new Error("evaluation_auth_unavailable");
      begunAt = now();
      try { return (await client.createSigninRequest({ nonce: randomUUID(), prompt: "login", extraQueryParams: { lang: "ja" } })).url; }
      catch { closed = true; throw new Error("evaluation_auth_unavailable"); }
    },
    async complete(value) {
      if (closed || begunAt === undefined || now() - begunAt > 600_000) throw new Error("evaluation_auth_unavailable");
      const begun = begunAt; begunAt = undefined;
      completing = (async () => { try {
        const url = new URL(value);
        if (url.origin !== callback.origin || url.pathname !== callback.pathname || url.hash || url.username || url.password ||
          url.searchParams.getAll("state").length !== 1 || url.searchParams.getAll("code").length !== 1 || url.searchParams.has("error")) throw new Error();
        const response = await client.processSigninResponse(url.href);
        revocationToken = response.refresh_token;
        await validate(response);
        if (closed || now() - begun > 600_000) throw new Error();
        session = { response, expiresAt: now() + response.expires_in! * 1000, absoluteExpiresAt: now() + 12 * 60 * 60 * 1000 };
      } catch { closed = true; session = undefined; throw new Error("evaluation_auth_rejected"); } })();
      try { await completing; } finally { completing = undefined; }
    },
    async token() {
      if (closed || !session || now() >= session.absoluteExpiresAt) { session = undefined; throw new Error("evaluation_auth_expired"); }
      if (session.expiresAt - now() > 30_000) return session.response.access_token;
      if (refreshing) return refreshing;
      const previous = session;
      refreshing = (async () => {
        try {
          let response: SigninResponse;
          try { response = await client.useRefreshToken({ state: { refresh_token: previous.response.refresh_token!,
            id_token: previous.response.id_token, scope: previous.response.scope, session_state: previous.response.session_state, profile: previous.response.profile } }); }
          catch (error) {
            if (error instanceof ErrorResponse && error.error === "invalid_grant") { session = undefined; closed = true; }
            throw new Error("evaluation_auth_refresh_unavailable");
          }
          response.refresh_token ??= previous.response.refresh_token;
          revocationToken = response.refresh_token;
          try { await validate(response); } catch { session = undefined; closed = true; throw new Error("evaluation_auth_rejected"); }
          if (closed || now() >= previous.absoluteExpiresAt) throw new Error();
          session = { response, expiresAt: Math.min(now() + response.expires_in! * 1000, previous.absoluteExpiresAt), absoluteExpiresAt: previous.absoluteExpiresAt };
          return response.access_token;
        } catch { throw new Error("evaluation_auth_refresh_unavailable"); }
        finally { refreshing = undefined; }
      })();
      return refreshing;
    },
    async close() {
      closed = true; begunAt = undefined;
      await completing?.catch(() => undefined);
      await refreshing?.catch(() => undefined);
      const refresh = revocationToken; session = undefined; revocationToken = undefined;
      if (refresh) { try { await client.revokeToken(refresh, "refresh_token"); } catch { throw new Error("evaluation_revoke_unconfirmed"); } }
    },
  };
}
