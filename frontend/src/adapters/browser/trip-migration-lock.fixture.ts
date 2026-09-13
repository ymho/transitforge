/** Deterministic shared lock fake for cross-tab import tests. No browser fallback uses this. */
export function migrationLockFixture(): Pick<LockManager, "request"> {
  let tail: Promise<unknown> = Promise.resolve();
  return { request: ((_name: string, _options: LockOptions, run: () => Promise<unknown>) => {
    const result = tail.then(run); tail = result.catch(() => {}); return result;
  }) as LockManager["request"] };
}
