import { type TripUpdateProposal, validateActivityResearchReference } from "./trip";
import { exactKeys } from "./snapshot-validation";
import { parsePublicRequestProposal } from "./public-request-proposal";

/** Bounded publication boundary; item proposals carry only authored/manual facts. */
export function parsePublicTripProposal(value: unknown): TripUpdateProposal {
  const raw = JSON.stringify(value);
  if (!raw || new TextEncoder().encode(raw).length > 16_384) throw new Error("Proposal exceeds public limit");
  const proposal = JSON.parse(raw) as TripUpdateProposal;
  exactKeys(proposal, ["tripId", "baseRevision", "summary", "patches", "intentBinding"]);
  if (proposal.patches?.[0]?.type === "request") return parsePublicRequestProposal(proposal);
  if (typeof proposal.tripId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(proposal.tripId) ||
      !Number.isSafeInteger(proposal.baseRevision) || proposal.baseRevision < 0 || typeof proposal.summary !== "string" ||
      !proposal.summary.trim() || proposal.summary.length > 500 || proposal.intentBinding !== undefined ||
      !Array.isArray(proposal.patches) || ![1, 2].includes(proposal.patches.length)) throw new Error("Invalid item proposal");
  const [first, second] = proposal.patches;
  if (!first || !["add", "replace", "remove", "move"].includes(first.type) ||
      second && (second.type !== "planning" || !["itinerary_draft", "itinerary_refinement"].includes(second.state))) throw new Error("Invalid item patches");
  if (first.type === "add" || first.type === "replace") {
    exactKeys(first, first.type === "add" ? ["type", "item", "afterId"] : ["type", "itemId", "item"]);
    const item = first.item;
    if (!item || typeof item !== "object" || !["activity", "transport", "stay"].includes(item.type)) throw new Error("Invalid public item");
    exactKeys(item, item.type === "activity" ? ["type", "id", "title", "schedule", "logicalDayId", "decision", "category", "place", "research"]
      : item.type === "transport" ? ["type", "id", "title", "schedule", "logicalDayId", "decision", "detail"]
        : ["type", "id", "title", "schedule", "logicalDayId", "decision", "selection"]);
    const manual = (place: { name?: unknown; sources?: readonly unknown[] }) =>
      !!place && typeof place === "object" && !Array.isArray(place) && Object.keys(place).every(key => ["name", "sources"].includes(key)) && typeof place.name === "string" && !!place.name.trim() &&
      place.name.length <= 200 && Array.isArray(place.sources) && place.sources.length === 0;
    if (item.type === "activity" && item.research !== undefined) {
      if (!item.place || !manual(item.place)) throw new Error("Research reference requires a manual place");
      validateActivityResearchReference(item.research);
    }
    if (item.type === "activity" && item.place && !manual(item.place) ||
        item.type === "transport" && item.detail.status === "selected" && (item.detail.mode === "rail" || item.detail.provenance.type !== "manual" || !manual(item.detail.origin) || !manual(item.detail.destination)) ||
        item.type === "stay" && (item.selection.status !== "unselected" || item.selection.place && !manual(item.selection.place)))
      throw new Error("Provider data must use a trusted selection boundary");
  } else exactKeys(first, first.type === "remove" ? ["type", "itemId"] : ["type", "itemId", "afterId"]);
  if (second) exactKeys(second, ["type", "state"]);
  return structuredClone(proposal);
}
