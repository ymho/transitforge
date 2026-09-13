import { railSelectionFixture } from "./selected-rail-journey.fixture";
import { selectRailJourney, projectRailSchedule } from "./selected-rail-journey";
import { createTrip } from "./trip";
/** Synthetic adopted rail plan, never live/private data. */
export function watchTrip() {
  const f = railSelectionFixture(), journey = selectRailJourney(f.candidate, f.inputs, f.selectedAt);
  return createTrip("11111111-1111-4111-8111-111111111111", "旅", f.selectedAt, [
    { id: "rail", title: "移動", type: "transport", schedule: projectRailSchedule(journey), detail: { mode: "rail", status: "selected", journey } },
  ]);
}
