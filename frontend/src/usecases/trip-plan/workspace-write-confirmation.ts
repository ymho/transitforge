import { applyTripProposal, type Trip, type TripUpdateProposal } from "@raiquora/trip/trip";

const stable = (value: unknown) => JSON.stringify(value, (_key, entry: unknown) =>
  entry && typeof entry === "object" && !Array.isArray(entry)
    ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry);

/** Manual edits retain acquired selections/evidence; candidate adoption uses its dedicated boundary. */
export async function validateWorkspaceWriteConfirmation(trip: Trip, proposal: TripUpdateProposal): Promise<void> {
  applyTripProposal(trip, proposal);
  const manualTransport = proposal.patches.some(patch => patch.type === "replace" && patch.item.type === "transport" &&
    patch.item.detail.status === "selected" && patch.item.detail.mode !== "rail" && patch.item.detail.provenance.type === "manual");
  for (const patch of proposal.patches) {
    if (["request", "title", "cost_forecast", "cost_override", "cost_lines", "item_booking", "item_memo", "remove", "move"].includes(patch.type)) continue;
    if (patch.type === "planning" && manualTransport && ["itinerary_draft", "itinerary_refinement"].includes(patch.state)) continue;
    if (patch.type === "replace") {
      const before = trip.items.find(item => item.id === patch.itemId), after = patch.item;
      if (before && before.type === after.type) {
        const { title: _title, schedule: _schedule, logicalDayId: _day, plannedTiming: _time, ...retainedBefore } = before as typeof before & { plannedTiming?: unknown };
        const { title: _newTitle, schedule: _newSchedule, logicalDayId: _newDay, plannedTiming: _newTime, ...retainedAfter } = after as typeof after & { plannedTiming?: unknown };
        if (before.type === "transport" && after.type === "transport") {
          if (before.detail.status === "selected" && (before.detail.mode === "rail" || before.detail.provenance.type === "provider") &&
            stable(before.schedule) !== stable(after.schedule)) throw new Error("検索済み経路の時刻は、経路を選び直してください。");
          if ((before.detail.status === "unresolved" || before.detail.status === "selected" && before.detail.mode !== "rail" && before.detail.provenance.type === "manual") &&
            after.detail.status === "selected" && after.detail.mode !== "rail" && after.detail.provenance.type === "manual") {
            Object.assign(retainedAfter, { detail: before.detail });
          }
        }
        if (before.type === "stay" && after.type === "stay" && before.selection.status === "selected" && stable(before.schedule) !== stable(after.schedule)) throw new Error("宿泊日は宿を選び直してください。");
        if (stable(retainedBefore) === stable(retainedAfter)) continue;
      }
    }
    throw new Error("この予定の変更には、候補・予約の確認が必要です。");
  }
}
