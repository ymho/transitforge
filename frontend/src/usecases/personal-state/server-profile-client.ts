import type { UserProfile } from "@raiquora/trip/travel-profile";
export interface ServerProfileState { profile: UserProfile; revision: number }
/** Authenticated transport port for the account-scoped Profile source of truth. */
export interface ServerProfileClient {
  get(): Promise<ServerProfileState | undefined>;
  update(profile: UserProfile, expectedRevision: number | null): Promise<ServerProfileState>;
  delete(expectedRevision: number): Promise<void>;
}
