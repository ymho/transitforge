import type { Trip } from "@raiquora/trip/trip";
import { previewChecklistProposal, validateChecklistItems, type ChecklistProposal, type TripChecklistItem } from "@raiquora/trip/trip-checklist";
import { validateChecklistCommand, type ChecklistCommand } from "@raiquora/trip/checklist-edit";

/** Host read/write seam, not another persisted resource. No default/public writer. */
export interface ChecklistWorkspacePort {
  getItems(): readonly TripChecklistItem[] | undefined;
  write?(command: ChecklistCommand): Promise<void>;
}
export function createChecklistWorkspaceController(host: {
  trip(): Trip | undefined; port(): ChecklistWorkspacePort | undefined; session(): string; publish(): void;
}) {
  const previews = new Map<string, ChecklistProposal>(), pending = new Set<string>();
  const items = () => {
    const trip = host.trip(), values = host.port()?.getItems();
    if (!trip || !values) return undefined;
    validateChecklistItems(trip.id, values); return structuredClone(values);
  };
  const preview = (proposal: ChecklistProposal) => {
    const trip = host.trip(), values = items();
    if (!trip || trip.id !== proposal.tripId || !values) throw new Error("準備リストを取得してから提案を確認してください");
    const result = previewChecklistProposal(proposal, values);
    if (result.suggestions.length) previews.set(host.session(), { tripId: trip.id, suggestions: result.suggestions });
    else previews.delete(host.session());
    host.publish(); return result;
  };
  const write = async (command: ChecklistCommand) => {
    validateChecklistCommand(command);
    const session = host.session(), trip = host.trip(), port = host.port();
    const tripId = command.operation === "confirm-suggestions" ? command.proposal.tripId : command.tripId;
    if (!trip || trip.id !== tripId || !port?.write || pending.has(session) || !items()) throw new Error("準備リストは現在変更できません");
    pending.add(session); host.publish();
    try { await port.write(structuredClone(command)); }
    finally { pending.delete(session); host.publish(); }
  };
  return { items, preview, write,
    forget: (session: string) => { previews.delete(session); },
    canWrite: () => !!host.port()?.write && !!items() && !pending.has(host.session()),
    proposal: () => { const p = previews.get(host.session()); return p?.tripId === host.trip()?.id ? structuredClone(p) : undefined; },
    dismiss: () => { previews.delete(host.session()); host.publish(); },
    async confirm() {
      const session = host.session(), p = previews.get(session);
      if (!p) throw new Error("確認する準備提案がありません");
      await write({ operation: "confirm-suggestions", proposal: p });
      if (previews.get(session) === p) previews.delete(session);
      host.publish();
    },
  };
}
export type ChecklistWorkspaceController = ReturnType<typeof createChecklistWorkspaceController>;
