import type { TripPlan } from "./trip-plan";
import type { UserProfile } from "./travel-profile";

export const conversationSessionStorageKey = "transitforge.conversation-sessions.v2";
export const travelMemoryStorageKey = "transitforge.travel-memories.v1";
const legacyConversationSessionStorageKey = "transitforge.conversation-sessions.v1";
const maximumSessions = 20;
const maximumMemories = 20;

export type ConversationScope = "general" | "trip" | "place" | "route";

export interface ConversationSession {
  id: string;
  scope: ConversationScope;
  tripPlanId?: string;
  summary: string;
  resolvedTopics: string[];
  pendingTopics: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TravelMemory {
  id: string;
  statement: string;
  confidence: "low" | "high";
  sourceSessionId: string;
  createdAt: string;
}

interface ConversationSessionStore {
  version: 2;
  activeSessionId: string;
  sessions: ConversationSession[];
}

export function createConversationSession(
  scope: ConversationScope = "general",
  tripPlanId?: string,
  now = new Date(),
): ConversationSession {
  const timestamp = now.toISOString();
  return {
    id: crypto.randomUUID(),
    scope,
    ...(tripPlanId ? { tripPlanId } : {}),
    summary: "",
    resolvedTopics: [],
    pendingTopics: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function loadConversationSession(
  storage: Pick<Storage, "getItem">,
): ConversationSession | undefined {
  const store = readConversationSessionStore(storage);
  if (store) {
    return store.sessions.find((session) => session.id === store.activeSessionId);
  }
  return readLegacyConversationSession(storage);
}

export function saveConversationSession(
  storage: Pick<Storage, "getItem" | "setItem">,
  session: ConversationSession,
): void {
  const stored = readConversationSessionStore(storage);
  const previous = stored?.sessions ?? [];
  const sessions = [
    ...previous.filter((candidate) => candidate.id !== session.id),
    session,
  ].slice(-maximumSessions);
  storage.setItem(conversationSessionStorageKey, JSON.stringify({
    version: 2,
    activeSessionId: session.id,
    sessions,
  } satisfies ConversationSessionStore));
}

export function loadTravelMemories(
  storage: Pick<Storage, "getItem">,
): TravelMemory[] {
  try {
    const raw = storage.getItem(travelMemoryStorageKey);
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value)
      ? value.filter(isTravelMemory).slice(-maximumMemories)
      : [];
  } catch {
    return [];
  }
}

export function rememberTravelPreference(
  storage: Pick<Storage, "getItem" | "setItem">,
  statement: string,
  sessionId: string,
  confidence: TravelMemory["confidence"],
  now = new Date(),
): void {
  const value = statement.trim().slice(0, 200);
  if (!value || !isSafeIdentifier(sessionId)) return;
  const previous = loadTravelMemories(storage).filter(
    (memory) => memory.statement.normalize("NFKC") !== value.normalize("NFKC"),
  );
  storage.setItem(travelMemoryStorageKey, JSON.stringify([
    ...previous,
    {
      id: crypto.randomUUID(),
      statement: value,
      confidence,
      sourceSessionId: sessionId,
      createdAt: now.toISOString(),
    },
  ].slice(-maximumMemories)));
}

export function conversationContextSummary(
  profile: UserProfile | undefined,
  plan: TripPlan | undefined,
  session: ConversationSession,
  memories: TravelMemory[],
): string {
  const context = {
    profile: profile ? {
      home: profile.home,
      companions: profile.companions,
      travelStyle: profile.travelStyle,
      preferences: profile.preferences,
      transport: profile.transport,
    } : undefined,
    tripPlan: plan ? {
      id: plan.id,
      title: plan.title,
      destination: plan.destination,
      conditions: plan.conditions,
      items: plan.items.slice(0, 12).map(compactTripPlanItem),
    } : undefined,
    session: {
      id: session.id,
      scope: session.scope,
      summary: session.summary.slice(0, 300),
      resolvedTopics: session.resolvedTopics.slice(0, 8),
      pendingTopics: session.pendingTopics.slice(0, 8),
    },
    relevantMemories: memories
      .filter((memory) => memory.confidence === "high")
      .slice(-8)
      .map((memory) => memory.statement.slice(0, 120)),
  };
  const serialized = JSON.stringify(context);
  if (serialized.length <= 1_100) return serialized;
  return JSON.stringify({
    profile: profile ? {
      home: profile.home,
      companions: profile.companions.usual,
      pace: profile.travelStyle.pace,
      maxTravelMinutes: profile.transport.maxTypicalTravelMinutes,
    } : undefined,
    tripPlan: plan ? { id: plan.id, destination: plan.destination } : undefined,
    session: {
      id: session.id,
      scope: session.scope,
      summary: session.summary.slice(0, 200),
      pendingTopics: session.pendingTopics.slice(0, 4),
    },
    relevantMemories: memories
      .filter((memory) => memory.confidence === "high")
      .slice(-4)
      .map((memory) => memory.statement.slice(0, 80)),
  });
}

function compactTripPlanItem(item: TripPlan["items"][number]) {
  if (item.type === "movement") {
    return item.mode === "rail"
      ? {
          type: item.type,
          mode: item.mode,
          from: item.route.originStation,
          to: item.route.destinationStation,
          date: item.route.departureDate,
        }
      : {
          type: item.type,
          mode: item.mode,
          from: item.origin,
          to: item.destination,
          date: item.date,
        };
  }
  if (item.type === "stay") {
    return {
      type: item.type,
      destination: item.destination,
      checkInDate: item.checkInDate,
      checkOutDate: item.checkOutDate,
      accommodation: item.accommodation?.name,
    };
  }
  return { type: item.type, place: item.place.name, date: item.date };
}

function readConversationSessionStore(
  storage: Pick<Storage, "getItem">,
): ConversationSessionStore | undefined {
  try {
    const raw = storage.getItem(conversationSessionStorageKey);
    if (!raw) return undefined;
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== 2 ||
      typeof value.activeSessionId !== "string" || !Array.isArray(value.sessions)) {
      return undefined;
    }
    const sessions = value.sessions.filter(isConversationSession).slice(-maximumSessions);
    if (!sessions.some((session) => session.id === value.activeSessionId)) return undefined;
    return { version: 2, activeSessionId: value.activeSessionId, sessions };
  } catch {
    return undefined;
  }
}

function readLegacyConversationSession(
  storage: Pick<Storage, "getItem">,
): ConversationSession | undefined {
  try {
    const raw = storage.getItem(legacyConversationSessionStorageKey);
    if (!raw) return undefined;
    const value: unknown = JSON.parse(raw);
    return isConversationSession(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function isConversationSession(value: unknown): value is ConversationSession {
  if (!isRecord(value) || !isSafeIdentifier(value.id) ||
    !isConversationScope(value.scope) || typeof value.summary !== "string" ||
    !isStringArray(value.resolvedTopics) || !isStringArray(value.pendingTopics) ||
    typeof value.createdAt !== "string" || typeof value.updatedAt !== "string") {
    return false;
  }
  return value.tripPlanId === undefined || isSafeIdentifier(value.tripPlanId);
}

function isTravelMemory(value: unknown): value is TravelMemory {
  return isRecord(value) && isSafeIdentifier(value.id) &&
    typeof value.statement === "string" && value.statement.length <= 200 &&
    (value.confidence === "low" || value.confidence === "high") &&
    isSafeIdentifier(value.sourceSessionId) && typeof value.createdAt === "string";
}

function isConversationScope(value: unknown): value is ConversationScope {
  return value === "general" || value === "trip" || value === "place" || value === "route";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 20 &&
    value.every((item) => typeof item === "string" && item.length <= 200);
}

function isSafeIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 100;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
