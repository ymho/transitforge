import { isUserProfile, type UserProfile } from "@raiquora/trip/travel-profile";
import { requestSessionVersion } from "./authenticated-fetch";
import { personalApiFetch } from "./personal-api-fetch";
import type { ServerProfileClient, ServerProfileState } from "../../usecases/personal-state/server-profile-client";
function profileState(value: unknown): ServerProfileState {
  const v = value as Partial<ServerProfileState>;
  if (!v || typeof v !== "object" || !isUserProfile(v.profile) || !Number.isSafeInteger(v.revision)) throw new Error("Invalid Profile API response");
  return { profile: structuredClone(v.profile), revision: v.revision! };
}
export class HttpServerProfileClient implements ServerProfileClient {
  constructor(private readonly endpoint = "/api/profile/v1", private readonly request: typeof fetch = personalApiFetch) {}
  private async execute(command: Record<string, unknown>) {
    const epoch = requestSessionVersion(this.request);
    const response = await this.request(this.endpoint, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ version: "profile-api-v1", ...command }), signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error("Profile API unavailable");
    const value: unknown = await response.json();
    if (epoch !== requestSessionVersion(this.request) || !value || typeof value !== "object" || (value as { version?: unknown }).version !== "profile-api-v1") throw new Error("Invalid Profile API response");
    return value as Record<string, unknown>;
  }
  async get() { const v = await this.execute({ operation: "get" }); return v.profile === null ? undefined : profileState(v); }
  async update(profile: UserProfile, expectedRevision: number | null) { return profileState(await this.execute({ operation: "update", profile, expectedRevision })); }
  async delete(expectedRevision: number) { const v = await this.execute({ operation: "delete", expectedRevision }); if (v.ok !== true) throw new Error("Invalid Profile API response"); }
}
