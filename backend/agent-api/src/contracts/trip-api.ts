import { decodeTrip, type Trip, type TripUpdateProposal } from "@raiquora/trip/trip";

export const tripApiVersion = "trip-api-v1";
export const tripApiLimits = { bodyBytes: 256 * 1024, items: 100, constraints: 100, assumptions: 100, stringLength: 4096, arrayLength: 1000, depth: 32 } as const;
export type TripErrorCode = "unauthenticated" | "not-found" | "already-exists" | "invalid-input" | "payload-too-large" | "unavailable" | "conflict" | "mutation-reused" | "confirmation-required" | "feasibility-required";
/** Constant categories only: never propagate SDK/Domain messages containing private data. */
export class TripResourceError extends Error {
  constructor(readonly code: TripErrorCode) { super(code); }
}
export function tripIdentifier(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value)) throw new TripResourceError("invalid-input");
}
export function conversationIdentifier(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) throw new TripResourceError("invalid-input");
}
export function boundedTrip(value: unknown): Trip {
  checkBounds(value);
  try {
    const raw = value as { items?: unknown[]; request?: { constraints?: unknown[]; assumptions?: unknown[] } };
    if (Array.isArray(raw.items) && raw.items.length > tripApiLimits.items ||
        Array.isArray(raw.request?.constraints) && raw.request!.constraints!.length > tripApiLimits.constraints ||
        Array.isArray(raw.request?.assumptions) && raw.request!.assumptions!.length > tripApiLimits.assumptions) {
      throw new TripResourceError("payload-too-large");
    }
    const trip = decodeTrip(value);
    if (!Array.isArray(trip?.items) || !Array.isArray(trip.request?.constraints) || !Array.isArray(trip.request?.assumptions)) throw new Error();
    if (trip.items.length > tripApiLimits.items || trip.request.constraints.length > tripApiLimits.constraints || trip.request.assumptions.length > tripApiLimits.assumptions) throw new TripResourceError("payload-too-large");
    if (Buffer.byteLength(JSON.stringify(trip), "utf8") > tripApiLimits.bodyBytes) throw new TripResourceError("payload-too-large");
    return structuredClone(trip);
  } catch (error) {
    if (error instanceof TripResourceError) throw error;
    throw new TripResourceError("invalid-input");
  }
}
function checkBounds(value: unknown, depth = 0): void {
  if (depth > tripApiLimits.depth || typeof value === "string" && value.length > tripApiLimits.stringLength || Array.isArray(value) && value.length > tripApiLimits.arrayLength) throw new TripResourceError("payload-too-large");
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) checkBounds(child, depth + 1);
  } else if (typeof value === "number" && !Number.isFinite(value)) throw new TripResourceError("invalid-input");
}
export type TripApiCommand =
  | { version: typeof tripApiVersion; operation: "generate-title"; tripId: string; baseRevision: number }
  | { version: typeof tripApiVersion; operation: "create"; trip: Trip }
  | { version: typeof tripApiVersion; operation: "start-consultation"; tripId: string; title: string; userRequest?: string }
  | { version: typeof tripApiVersion; operation: "branch-consultation"; sourceTripId: string; sourceRevision: number; tripId: string; title: string }
  | ({ version: typeof tripApiVersion; operation: "mutate" } & TripMutation)
  | { version: typeof tripApiVersion; operation: "get" | "archive"; tripId: string }
  | { version: typeof tripApiVersion; operation: "list"; afterTripId?: string; limit?: number }
  | { version: typeof tripApiVersion; operation: "attach"; conversationId: string; tripId: string }
  | { version: typeof tripApiVersion; operation: "detach" | "reference"; conversationId: string };

export type PlanAdoptionApiCommand = { version: typeof tripApiVersion; operation: "preview-plan-adoption" | "confirm-plan-adoption";
  conversationId: string; candidateSetId: string; candidateSetRevision: number; variantId: string; tripId: string; baseTripRevision: number; mutationId: string; confirmationKey?: string };

export function parsePlanAdoptionCommand(value: unknown): PlanAdoptionApiCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TripResourceError("invalid-input");
  const command = value as Record<string, unknown>;
  if (command.version !== tripApiVersion || !["preview-plan-adoption", "confirm-plan-adoption"].includes(String(command.operation))) throw new TripResourceError("invalid-input");
  const confirm = command.operation === "confirm-plan-adoption";
  const keys = ["version", "operation", "conversationId", "candidateSetId", "candidateSetRevision", "variantId", "tripId", "baseTripRevision", "mutationId", ...(confirm ? ["confirmationKey"] : [])];
  if (Object.keys(command).some((key) => !keys.includes(key)) || confirm !== (command.confirmationKey !== undefined)) throw new TripResourceError("invalid-input");
  conversationIdentifier(command.conversationId); tripIdentifier(command.tripId); tripIdentifier(command.mutationId);
  for (const ref of [command.candidateSetId, command.variantId]) if (typeof ref !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u.test(ref)) throw new TripResourceError("invalid-input");
  if (![command.candidateSetRevision, command.baseTripRevision].every((item) => Number.isSafeInteger(item) && Number(item) >= 0) ||
      confirm && (typeof command.confirmationKey !== "string" || !/^[0-9a-f]{64}$/u.test(command.confirmationKey))) throw new TripResourceError("invalid-input");
  return structuredClone(command) as unknown as PlanAdoptionApiCommand;
}

export type TripAdoptionApiCommand = { version: typeof tripApiVersion; operation: "preview-trip-adoption" | "confirm-trip-adoption";
  tripId: string; baseTripRevision: number; mutationId: string; action: "confirm" | "withdraw"; confirmationKey?: string };
export function parseTripAdoptionCommand(value: unknown): TripAdoptionApiCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TripResourceError("invalid-input");
  const command = value as Record<string, unknown>, confirm = command.operation === "confirm-trip-adoption";
  const keys = ["version", "operation", "tripId", "baseTripRevision", "mutationId", "action", ...(confirm ? ["confirmationKey"] : [])];
  if (command.version !== tripApiVersion || !["preview-trip-adoption", "confirm-trip-adoption"].includes(String(command.operation)) ||
      Object.keys(command).some(key => !keys.includes(key)) || confirm !== (command.confirmationKey !== undefined)) throw new TripResourceError("invalid-input");
  tripIdentifier(command.tripId); tripIdentifier(command.mutationId);
  if (!Number.isSafeInteger(command.baseTripRevision) || Number(command.baseTripRevision) < 0 || !["confirm", "withdraw"].includes(String(command.action)) ||
      confirm && (typeof command.confirmationKey !== "string" || !/^[0-9a-f]{64}$/u.test(command.confirmationKey))) throw new TripResourceError("invalid-input");
  return structuredClone(command) as unknown as TripAdoptionApiCommand;
}

export type ItemDecisionApiCommand = { version: typeof tripApiVersion; operation: "preview-item-decision" | "confirm-item-decision";
  tripId: string; itemId: string; baseTripRevision: number; mutationId: string; action: "confirm" | "withdraw"; confirmationKey?: string };
export function parseItemDecisionCommand(value: unknown): ItemDecisionApiCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TripResourceError("invalid-input");
  const command = value as Record<string, unknown>, confirm = command.operation === "confirm-item-decision";
  const keys = ["version", "operation", "tripId", "itemId", "baseTripRevision", "mutationId", "action", ...(confirm ? ["confirmationKey"] : [])];
  if (command.version !== tripApiVersion || !["preview-item-decision", "confirm-item-decision"].includes(String(command.operation)) ||
      Object.keys(command).some(key => !keys.includes(key)) || confirm !== (command.confirmationKey !== undefined)) throw new TripResourceError("invalid-input");
  tripIdentifier(command.tripId); tripIdentifier(command.mutationId);
  if (typeof command.itemId !== "string" || !command.itemId.trim() || command.itemId.length > 160 ||
      !Number.isSafeInteger(command.baseTripRevision) || Number(command.baseTripRevision) < 0 ||
      !["confirm", "withdraw"].includes(String(command.action)) ||
      confirm && (typeof command.confirmationKey !== "string" || !/^[0-9a-f]{64}$/u.test(command.confirmationKey))) throw new TripResourceError("invalid-input");
  return structuredClone(command) as unknown as ItemDecisionApiCommand;
}

export interface TripMutation {
  tripId: string;
  baseRevision: number;
  mutationId: string;
  proposal: TripUpdateProposal;
}
export function validateMutation(value: TripMutation): void {
  tripIdentifier(value.tripId); tripIdentifier(value.mutationId);
  if (!Number.isSafeInteger(value.baseRevision) || value.baseRevision < 0 || value.baseRevision === Number.MAX_SAFE_INTEGER ||
      value.proposal?.tripId !== value.tripId || value.proposal.baseRevision !== value.baseRevision) throw new TripResourceError("invalid-input");
  checkBounds(value.proposal);
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > tripApiLimits.bodyBytes) throw new TripResourceError("payload-too-large");
}

export function parseTripCommand(value: unknown): TripApiCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TripResourceError("invalid-input");
  const v = value as Record<string, unknown>;
  if (v.version !== tripApiVersion) throw new TripResourceError("invalid-input");
  let keys: string[];
  switch (v.operation) {
    case "start-consultation":
      keys = ["tripId", "title", "userRequest"]; tripIdentifier(v.tripId);
      if (v.userRequest !== undefined && (typeof v.userRequest !== "string" || !v.userRequest.trim() || v.userRequest.length > 32000)) throw new TripResourceError("invalid-input");
      if (typeof v.title !== "string" || !v.title.trim() || v.title.length > 160) throw new TripResourceError("invalid-input");
      break;
    case "branch-consultation":
      keys = ["sourceTripId", "sourceRevision", "tripId", "title"]; tripIdentifier(v.sourceTripId); tripIdentifier(v.tripId);
      if (v.sourceTripId === v.tripId || !Number.isSafeInteger(v.sourceRevision) || Number(v.sourceRevision) < 0 ||
          typeof v.title !== "string" || !v.title.trim() || v.title.length > 160) throw new TripResourceError("invalid-input");
      break;
    case "generate-title":
      keys = ["tripId", "baseRevision"]; tripIdentifier(v.tripId);
      if (!Number.isSafeInteger(v.baseRevision) || Number(v.baseRevision) < 0) throw new TripResourceError("invalid-input");
      break;
    case "create": keys = ["trip"]; boundedTrip(v.trip); break;
    case "mutate": keys = ["tripId", "baseRevision", "mutationId", "proposal"]; validateMutation(v as unknown as TripMutation); break;
    case "get": case "archive": keys = ["tripId"]; tripIdentifier(v.tripId); break;
    case "list":
      keys = ["limit", "afterTripId"];
      if (v.limit !== undefined && (!Number.isInteger(v.limit) || (v.limit as number) < 1 || (v.limit as number) > 50)) throw new TripResourceError("invalid-input");
      if (v.afterTripId !== undefined) tripIdentifier(v.afterTripId);
      break;
    case "attach": keys = ["conversationId", "tripId"]; conversationIdentifier(v.conversationId); tripIdentifier(v.tripId); break;
    case "detach": case "reference": keys = ["conversationId"]; conversationIdentifier(v.conversationId); break;
    default: throw new TripResourceError("invalid-input");
  }
  if (Object.keys(v).some((key) => !["version", "operation", ...keys].includes(key))) throw new TripResourceError("invalid-input");
  return structuredClone(value) as TripApiCommand;
}
