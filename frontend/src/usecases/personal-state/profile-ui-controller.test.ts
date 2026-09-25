import { describe, expect, it, vi } from "vitest";
import { ProfileUiController } from "./profile-ui-controller";

const profile = { version: 2 as const, updatedAt: "2026-09-01T00:00:00Z", home: {}, companions: { usual: [], children: [] }, travelStyle: {}, preferences: {}, transport: {} };
describe("ProfileUiController", () => {
  it("hydrates, updates, and clears only its memory projection", async () => {
    const client = { get: async () => ({ profile, revision: 1 }), update: async () => ({ profile, revision: 2 }), delete: async () => undefined };
    const controller = new ProfileUiController(client);
    await controller.hydrate(); expect(controller.current()?.revision).toBe(1);
    await controller.update(profile); expect(controller.current()?.revision).toBe(2);
    controller.clear(); expect(controller.current()).toBeUndefined();
  });
  it("drops a response from a cleared account", async () => {
    let resolve!: (value: { profile: typeof profile; revision: number }) => void;
    const client = { get: () => new Promise<typeof profile extends never ? never : { profile: typeof profile; revision: number }>((done) => { resolve = done; }), update: async () => ({ profile, revision: 2 }), delete: async () => undefined };
    const controller = new ProfileUiController(client);
    const pending = controller.hydrate(); controller.clear(); resolve({ profile, revision: 1 });
    await expect(pending).resolves.toBeUndefined(); expect(controller.current()).toBeUndefined();
  });
  it("does not call the API while signed out", async () => {
    const get = vi.fn(async () => ({ profile, revision: 1 }));
    const controller = new ProfileUiController({ get, update: async () => ({ profile, revision: 2 }), delete: async () => undefined }, () => false);
    await expect(controller.hydrate()).rejects.toThrow("Authentication required");
    expect(get).not.toHaveBeenCalled();
  });
  it("serializes and coalesces autosaves with the latest CAS revision", async () => {
    let release!: () => void;
    const updates: Array<{ profile: typeof profile; revision: number | null }> = [];
    const client = { get: async () => ({ profile, revision: 1 }), delete: async () => undefined,
      update: vi.fn(async (next: typeof profile, revision: number | null) => {
        updates.push({ profile: structuredClone(next), revision });
        if (updates.length === 1) await new Promise<void>((resolve) => { release = resolve; });
        return { profile: next, revision: revision! + 1 };
      }) };
    const controller = new ProfileUiController(client); await controller.hydrate();
    const first = { ...profile, home: { station: "東" } }, second = { ...profile, home: { station: "東京" } };
    const saving = controller.autosave(first); expect(client.update).toHaveBeenCalledOnce();
    expect(controller.autosave(second)).toBe(saving);
    release(); await saving;
    expect(updates).toEqual([{ profile: first, revision: 1 }, { profile: second, revision: 2 }]);
    expect(controller.current()).toMatchObject({ profile: second, revision: 3 });
  });
  it("does not apply a late autosave response after account clear", async () => {
    let release!: () => void;
    const client = { get: async () => ({ profile, revision: 1 }), delete: async () => undefined,
      update: async () => { await new Promise<void>((resolve) => { release = resolve; }); return { profile, revision: 2 }; } };
    const controller = new ProfileUiController(client); await controller.hydrate();
    const saving = controller.autosave(profile); controller.clear(); release();
    await expect(saving).rejects.toThrow("Profile session changed");
    expect(controller.current()).toBeUndefined();
  });
});
