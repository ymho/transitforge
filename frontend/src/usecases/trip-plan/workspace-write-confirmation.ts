import type { Trip, TripUpdateProposal } from "@raiquora/trip/trip";

/** Metadata authored by the user needs no provider/candidate confirmation. */
export async function validateWorkspaceWriteConfirmation(_trip: Trip, proposal: TripUpdateProposal): Promise<void> {
  const allowed = ["request", "title", "cost_forecast", "cost_override", "item_booking", "item_memo"];
  if (proposal.patches.some(patch => !allowed.includes(patch.type))) {
    throw new Error("この予定の変更には、候補・予約の確認が必要です。");
  }
}
