import type { UserProfile } from "@raiquora/trip/travel-profile";
import type { ServerProfileClient, ServerProfileState } from "./server-profile-client";

/** Account-scoped Profile read model. Server API is the only persistence boundary. */
export class ProfileUiController {
  private value: ServerProfileState | undefined;
  private generation = 0;
  private readonly listeners = new Set<() => void>();
  constructor(private readonly client: ServerProfileClient, private readonly canUse = () => true) {}
  current(): ServerProfileState | undefined { return this.value && structuredClone(this.value); }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  clear(): void { this.generation++; this.value = undefined; this.notify(); }
  async hydrate(): Promise<ServerProfileState | undefined> {
    this.requireAuthentication();
    const generation = ++this.generation;
    const value = await this.client.get();
    if (generation !== this.generation) return undefined;
    this.value = value; this.notify(); return this.current();
  }
  async update(profile: UserProfile, expectedRevision = this.value?.revision ?? null): Promise<ServerProfileState> {
    this.requireAuthentication();
    const generation = this.generation;
    const saved = await this.client.update(profile, expectedRevision);
    if (generation !== this.generation) throw new Error("Profile session changed");
    this.value = saved; this.notify(); return structuredClone(saved);
  }
  async delete(expectedRevision = this.value?.revision): Promise<void> {
    this.requireAuthentication();
    if (expectedRevision === undefined) return;
    const generation = this.generation;
    await this.client.delete(expectedRevision);
    if (generation !== this.generation) throw new Error("Profile session changed");
    this.value = undefined; this.notify();
  }
  private notify(): void { for (const listener of this.listeners) listener(); }
  private requireAuthentication(): void { if (!this.canUse()) throw new Error("Authentication required"); }
}
