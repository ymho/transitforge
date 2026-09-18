export interface AuthConfig {
  issuer: string;
  clientId: string;
  loginOrigin: string;
  scopes: string[];
  callbackUrls: string[];
  logoutUrls: string[];
}

export function parseAuthConfig(value: unknown, origin: string): AuthConfig {
  const c = value as Partial<AuthConfig> | null;
  const httpsOrigin = (s: unknown): s is string => {
    if (typeof s !== "string") return false;
    try { const u = new URL(s); return u.protocol === "https:" && !u.username && !u.password && !u.search && !u.hash; }
    catch { return false; }
  };
  if (!c || !httpsOrigin(c.issuer) || !httpsOrigin(c.loginOrigin) ||
      new URL(c.loginOrigin).origin !== c.loginOrigin ||
      typeof c.clientId !== "string" || !/^[a-z0-9]+$/.test(c.clientId) ||
      !Array.isArray(c.scopes) || !c.scopes.includes("openid") ||
      !c.scopes.every(s => typeof s === "string" && /^[\w/.-]+$/.test(s)) ||
      !Array.isArray(c.callbackUrls) || !c.callbackUrls.includes(`${origin}/index.html`) ||
      !Array.isArray(c.logoutUrls) || !c.logoutUrls.includes(`${origin}/`)) {
    throw new Error("Authentication configuration unavailable");
  }
  return c as AuthConfig;
}

/** The current SPA only has these two document paths. Never preserve query/hash data. */
export function safeReturnPath(value: unknown): string {
  return value === "/index.html" ? "/index.html" : "/";
}
