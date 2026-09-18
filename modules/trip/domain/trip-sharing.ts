/** Read-safe authorization vocabulary. Never contains storage owner, principal or grant secret/hash. */
export type TripRole = "owner" | "editor" | "viewer";
export type SharedTripRole = Exclude<TripRole, "owner">;
export const canEditTrip = (role: TripRole): boolean => role === "owner" || role === "editor";
export interface TripParticipantView {
  id: string; tripId: string; role: SharedTripRole; version: number; active: boolean; joinedAt: string; updatedAt: string;
}
export interface ShareGrantView {
  id: string; tripId: string; role: SharedTripRole; version: number; createdAt: string; expiresAt: string; revokedAt?: string;
}
