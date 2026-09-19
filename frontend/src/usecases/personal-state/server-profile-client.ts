import type { UserProfile } from "@raiquora/trip/travel-profile";
export interface ServerProfileState { profile: UserProfile; revision: number }
/** Authenticated transport port. LocalStorage remains the production profile writer in this batch. */
export interface ServerProfileClient {
  get(): Promise<ServerProfileState | undefined>;
  update(profile: UserProfile, expectedRevision: number | null): Promise<ServerProfileState>;
  delete(expectedRevision: number): Promise<void>;
}
