import { validateTripParty, type TripParty } from "@raiquora/trip/trip-party";
import type { AskOnlyException } from "../../usecases/agent/agent-turn-outcome";

/** Adapter capability, supplied by the caller for the actual operation, never by the model. */
export function tripPartyProviderInput(party: TripParty, operation: { toolName: string; requiresExactChildAges: boolean }):
  | { ok: true; input: { adults: number; children: number; total: number; childAges?: number[] } }
  | { ok: false; missing: AskOnlyException[] } {
  validateTripParty(party);
  if (operation.requiresExactChildAges) {
    const missing = party.children.flatMap((child, index): AskOnlyException[] => child.age === undefined ? [{
      reason: "tool_input_missing", toolName: operation.toolName, inputName: `party.children.${index}.age`,
      missingFact: `子ども${index + 1}人目の年齢（このProvider操作に必要）`,
    }] : []);
    if (missing.length) return { ok: false, missing };
  }
  return { ok: true, input: { adults: party.adults, children: party.children.length, total: party.adults + party.children.length,
    ...(operation.requiresExactChildAges ? { childAges: party.children.map((c) => c.age!) } : {}) } };
}
