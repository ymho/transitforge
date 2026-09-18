import type { UserProfile } from "@raiquora/trip/travel-profile";
import type { TrustedPrincipal } from "../contracts/trusted-principal.js";
import type { ProfileState } from "../contracts/server-state.js";

export interface ProfileRepository {
  get(principal: TrustedPrincipal): Promise<ProfileState | undefined>;
  /** null means create only while absent; a revision means replace that live version only. */
  put(principal: TrustedPrincipal, profile: UserProfile, expectedRevision: number | null): Promise<ProfileState>;
  delete(principal: TrustedPrincipal, expectedRevision: number): Promise<void>;
}
