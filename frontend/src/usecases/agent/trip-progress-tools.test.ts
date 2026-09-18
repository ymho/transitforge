import { expect, it } from "vitest";
import { tripProgressDescriptors } from "./trip-progress-tools";
import { modelToolDescription } from "./tool-contract";
import { validateAgentToolInput } from "./agent-tool-input-validator";

it("distinguishes candidate replacement from removal without changing published inputs", () => {
  const selection = tripProgressDescriptors.find((t) => t.name === "propose_activity_selection")!;
  const removal = tripProgressDescriptors.find((t) => t.name === "propose_itinerary_removal_or_move")!;
  const contract = modelToolDescription(selection);
  expect(contract).toContain("operation=replace");
  expect(contract).toContain("名称や場所の再入力不要");
  expect(contract).toContain("ApplicationがTrip/task/期限/出所/保持許諾/scopeを検証");
  expect(modelToolDescription(removal)).toContain("適さない: 別候補への置き換え");
  expect(validateAgentToolInput(selection.inputSchema, { candidateId: "activity-a", itemId: "activity", operation: "replace" }).ok).toBe(true);
  expect(validateAgentToolInput(removal.inputSchema, { summary: "変更案", patches: [{ type: "replace", itemId: "activity" }] }).ok).toBe(false);
  expect(validateAgentToolInput(removal.inputSchema, { summary: "取りやめ案", patches: [{ type: "remove", itemId: "activity" }] }).ok).toBe(true);
});
