import type { TrustedPrincipal } from "../contracts/trusted-principal.js";
import { boundedProfile, requireStatePrincipal, revision, type StateClock } from "../contracts/server-state.js";
import type { ProfileRepository } from "../ports/profile-repository.js";

export class ProfileApplication {
  constructor(private readonly repository: ProfileRepository, private readonly clock: StateClock = { now: () => new Date() }) {}
  async get(principal: TrustedPrincipal) {
    requireStatePrincipal(principal);
    return this.repository.get(principal);
  }
  async update(principal: TrustedPrincipal, input: unknown, expectedRevision: number | null) {
    requireStatePrincipal(principal);
    if (expectedRevision !== null) revision(expectedRevision);
    const profile = boundedProfile(input);
    return this.repository.put(principal, { ...profile, updatedAt: this.clock.now().toISOString() }, expectedRevision);
  }
  async delete(principal: TrustedPrincipal, expectedRevision: number) {
    requireStatePrincipal(principal); revision(expectedRevision);
    return this.repository.delete(principal, expectedRevision);
  }
}
