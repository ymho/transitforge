import type { UserProfile } from "@raiquora/trip/travel-profile";
import type { ServerProfileClient, ServerProfileState } from "./server-profile-client";

/** Account-scoped Profile read model. Server API is the only persistence boundary. */
export class ProfileUiController {
  private value: ServerProfileState | undefined;
  private generation = 0;
  private readonly listeners = new Set<() => void>();
  private pendingAutosave?: UserProfile;
  private autosaveRun?: Promise<ServerProfileState>;
  constructor(private readonly client: ServerProfileClient, private readonly canUse = () => true) {}
  current(): ServerProfileState | undefined { return this.value && structuredClone(this.value); }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  clear(): void { this.generation++; this.pendingAutosave = undefined; this.autosaveRun = undefined; this.value = undefined; this.notify(); }
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
  /** Coalesces rapid edits and serializes CAS updates. A newer draft is never
   * overwritten by an older response; failures retain the latest draft for retry. */
  autosave(profile: UserProfile): Promise<ServerProfileState> {
    this.requireAuthentication();
    this.pendingAutosave = structuredClone(profile);
    if (this.autosaveRun) return this.autosaveRun;
    const generation = this.generation;
    const run = this.drainAutosave(generation);
    this.autosaveRun = run;
    void run.finally(() => { if (this.autosaveRun === run) this.autosaveRun = undefined; }).catch(() => undefined);
    return run;
  }
  async delete(expectedRevision = this.value?.revision): Promise<void> {
    this.requireAuthentication();
    if (this.autosaveRun) await this.autosaveRun;
    if (expectedRevision === undefined) return;
    const generation = this.generation;
    await this.client.delete(expectedRevision);
    if (generation !== this.generation) throw new Error("Profile session changed");
    this.value = undefined; this.notify();
  }
  private notify(): void { for (const listener of this.listeners) listener(); }
  private requireAuthentication(): void { if (!this.canUse()) throw new Error("Authentication required"); }
  private async drainAutosave(generation: number): Promise<ServerProfileState> {
    let latest: ServerProfileState | undefined;
    while (this.pendingAutosave) {
      const profile = this.pendingAutosave;
      this.pendingAutosave = undefined;
      try {
        latest = await this.update(profile, this.value?.revision ?? null);
      } catch (error) {
        if (generation === this.generation && !this.pendingAutosave) this.pendingAutosave = profile;
        throw error;
      }
      if (generation !== this.generation) throw new Error("Profile session changed");
    }
    if (!latest) throw new Error("No Profile change queued");
    return latest;
  }
}
