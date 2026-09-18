import { AuthenticationError } from "../contracts/trusted-principal.js";
import { jsonResponse, type LambdaHttpEvent } from "../contracts/http.js";

/** API Gateway v1 can expose the same header in both maps. Multi-value is authoritative,
 * but the single representation must agree. V2/Function URL coalesces duplicates with commas.
 * No forwarded identity header or requestContext claims are authentication evidence.
 */
export function accessTokenFromHttp(event: LambdaHttpEvent): string {
  const single = Object.entries(event.headers ?? {}).filter(([name]) => name.toLowerCase() === "authorization");
  const multiple = Object.entries(event.multiValueHeaders ?? {}).filter(([name]) => name.toLowerCase() === "authorization");
  const invalid = () => { throw new AuthenticationError("unauthenticated"); };
  if (single.length > 1 || multiple.length > 1) return invalid();
  const values = multiple[0]?.[1];
  if (multiple.length && (!Array.isArray(values) || values.length !== 1)) return invalid();
  const value = multiple.length ? values![0] : single[0]?.[1];
  if (single.length && multiple.length && single[0]![1] !== value) return invalid();
  if (typeof value !== "string" || value.length > 16_391) return invalid();
  const match = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/i.exec(value);
  if (!match) return invalid();
  return match[1]!;
}

/** Only safe categories cross HTTP. Do not log provider errors, tokens or claims. */
export function authenticationErrorResponse(error: unknown, version: string, requestId?: string) {
  if (!(error instanceof AuthenticationError)) return undefined;
  const response = jsonResponse(error.code === "unauthenticated" ? 401 : 403, { version, error: error.code }, requestId);
  if (response.statusCode === 401) response.headers["www-authenticate"] = "Bearer";
  return response;
}

export function httpMethod(event: LambdaHttpEvent): string | undefined {
  const v2 = event.requestContext?.http?.method, v1 = event.httpMethod;
  return v2 && v1 && v2 !== v1 ? undefined : v2 ?? v1;
}
