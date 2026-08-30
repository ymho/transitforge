export const contextViewKinds = [
  "map",
  "trip-plan",
  "journey-details",
] as const;

export type ContextViewKind = typeof contextViewKinds[number];
export type ContextEntityKind = "place" | "train" | "trip-plan" | "journey";

export interface ContextEntityReference {
  kind: ContextEntityKind;
  id: string;
}

export interface ContextWorkspaceState {
  version: 1;
  conversationSessionId: string;
  view: ContextViewKind;
  entity?: ContextEntityReference;
}

export function defaultContextWorkspaceState(
  conversationSessionId: string,
): ContextWorkspaceState {
  return { version: 1, conversationSessionId, view: "map" };
}

export function contextWorkspaceState(
  conversationSessionId: string,
  view: ContextViewKind,
  entity?: ContextEntityReference,
): ContextWorkspaceState | undefined {
  const sessionId = conversationSessionId.trim();
  if (!sessionId || !contextViewKinds.includes(view)) return undefined;
  if (entity && (!entity.id.trim() || !entityMatchesView(entity.kind, view))) {
    return undefined;
  }
  return {
    version: 1,
    conversationSessionId: sessionId,
    view,
    ...(entity ? { entity: { ...entity, id: entity.id.trim() } } : {}),
  };
}

export function isContextWorkspaceState(value: unknown): value is ContextWorkspaceState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ContextWorkspaceState>;
  return candidate.version === 1 &&
    typeof candidate.conversationSessionId === "string" &&
    contextViewKinds.includes(candidate.view as ContextViewKind) &&
    (candidate.entity === undefined || (
      typeof candidate.entity.id === "string" &&
      typeof candidate.entity.kind === "string" &&
      entityMatchesView(candidate.entity.kind as ContextEntityKind, candidate.view as ContextViewKind)
    ));
}

function entityMatchesView(
  entity: ContextEntityKind,
  view: ContextViewKind,
): boolean {
  if (view === "map") return entity === "place" || entity === "train";
  if (view === "trip-plan") return entity === "trip-plan";
  return entity === "journey";
}
