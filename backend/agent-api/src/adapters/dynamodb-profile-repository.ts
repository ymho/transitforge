import { PutItemCommand } from "@aws-sdk/client-dynamodb";
import type { UserProfile } from "@raiquora/trip/travel-profile";
import type { TrustedPrincipal } from "../contracts/trusted-principal.js";
import { StateError, boundedProfile, revision, type ProfileState } from "../contracts/server-state.js";
import type { ProfileRepository } from "../ports/profile-repository.js";
import { DynamoStateStore, type StateDynamoClient, type StateEnvelope } from "./dynamodb-state-store.js";

export class DynamoDbProfileRepository implements ProfileRepository {
  private readonly store: DynamoStateStore;
  constructor(table: string, client?: StateDynamoClient) { this.store = new DynamoStateStore(table, client); }
  private decode(value: StateEnvelope | undefined): ProfileState | undefined {
    if (!value || value.deleted) return undefined;
    try { return { profile: boundedProfile(value.payload), revision: value.revision }; }
    catch { throw new StateError("unavailable"); }
  }
  async get(principal: TrustedPrincipal) { return this.decode(await this.store.read(principal, "PROFILE")); }
  async put(principal: TrustedPrincipal, input: UserProfile, expected: number | null) {
    this.store.owner(principal);
    if (expected !== null) revision(expected);
    const profile = boundedProfile(input), old = await this.store.read(principal, "PROFILE"), current = this.decode(old);
    if (expected === null ? current !== undefined : !current) throw new StateError(expected === null ? "conflict" : "not-found");
    if (expected !== null && current?.revision !== expected) throw new StateError("conflict");
    const nextRevision = old ? old.revision + 1 : 0;
    revision(nextRevision);
    await this.store.send(new PutItemCommand(this.store.put(principal, "PROFILE", { revision: nextRevision, deleted: false, payload: profile }, old)));
    return { profile, revision: nextRevision };
  }
  async delete(principal: TrustedPrincipal, expected: number) {
    this.store.owner(principal); revision(expected);
    const old = await this.store.read(principal, "PROFILE"), current = this.decode(old);
    if (!current) throw new StateError("not-found");
    if (current.revision !== expected) throw new StateError("conflict");
    // Preserve a content-free generation fence so stale writes cannot modify a recreated profile.
    await this.store.send(new PutItemCommand(this.store.put(principal, "PROFILE", { revision: expected + 1, deleted: true }, old)));
  }
}
