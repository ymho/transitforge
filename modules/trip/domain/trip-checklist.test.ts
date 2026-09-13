import { it, expect } from "vitest";
import { checklistCategories, checklistStatuses, checklistSources, validateChecklistItem, validateChecklistProposal, previewChecklistProposal, checklistExactKey } from "./trip-checklist";
import { editChecklistItem, validateChecklistCommand } from "./checklist-edit";
import { checklistItem } from "./trip-checklist.fixture";

it("validates all categories/status/source combinations and optional links/date", () => {
  for (const category of checklistCategories) for (const status of checklistStatuses) for (const source of checklistSources) {
    expect(() => validateChecklistItem(checklistItem({ category, status, source, relatedItineraryItemId: "activity", relatedReservationId: checklistItem().id, dueDate: "2026-09-22" }))).not.toThrow();
  }
});
it("rejects unknown fields, invalid identity/revision, enums, text, date and private payload", () => {
  for (const fields of [{ category: "unknown" }, { status: "booked" }, { source: "provider" }, { title: " " }, { title: "x".repeat(201) },
    { title: "x\nsecret" }, { revision: -1 }, { revision: NaN }, { revision: Infinity }, { id: "x" }, { tripId: "" }, { archived: undefined },
    { dueDate: "2026-02-30" }, { relatedItineraryItemId: " " }, { relatedReservationId: "x" }, { raw: {} }, { bookingReference: "private" }]) {
    expect(() => validateChecklistItem({ ...checklistItem(), ...fields } as never)).toThrow();
  }
});
it("edits only explicit fields, supports done/reopen/not-needed/archive/unlink, independent revision", () => {
  const original = checklistItem({ revision: 7, relatedItineraryItemId: "deleted", relatedReservationId: checklistItem().id, dueDate: "2026-09-22" });
  let item = original;
  for (const status of ["done", "open", "not-needed"] as const) item = editChecklistItem(item, { operation: "update", tripId: item.tripId, id: item.id, baseRevision: item.revision, changes: { status } });
  item = editChecklistItem(item, { operation: "update", tripId: item.tripId, id: item.id, baseRevision: item.revision,
    changes: { title: "eSIM", archived: true, relatedItineraryItemId: null, relatedReservationId: null, dueDate: null } });
  expect(item).toMatchObject({ revision: 11, title: "eSIM", status: "not-needed", archived: true, source: "user" });
  expect(item).not.toHaveProperty("relatedReservationId"); expect(item).not.toHaveProperty("dueDate");
  expect(original).toEqual(checklistItem({ revision: 7, relatedItineraryItemId: "deleted", relatedReservationId: checklistItem().id, dueDate: "2026-09-22" }));
  expect(() => editChecklistItem(item, { operation: "update", tripId: item.tripId, id: item.id, baseRevision: 7, changes: { status: "open" } })).toThrow();
  expect(() => validateChecklistCommand({ operation: "update", tripId: item.tripId, id: item.id, baseRevision: 11, changes: { source: "model" } } as never)).toThrow();
});
it("dedupes exact NFKC/whitespace/ASCII case and never merges semantic synonyms or overwrites history", () => {
  for (const status of checklistStatuses) for (const archived of [false, true]) {
    const old = checklistItem({ status, archived });
    const proposal = { tripId: old.tripId, suggestions: [
      { category: "connectivity" as const, title: "　ＳｉＭ  " }, { category: "packing" as const, title: "傘" },
      { category: "packing" as const, title: "雨具" }, { category: "packing" as const, title: " 傘 " },
    ] };
    expect(previewChecklistProposal(proposal, [old])).toMatchObject({ skipped: 2, suggestions: [{ title: "傘" }, { title: "雨具" }] });
    expect(old).toEqual(checklistItem({ status, archived }));
  }
  expect(checklistExactKey({ category: "packing", title: "  USB　 Cable " })).toBe("packing:usb cable");
});
it("rejects model supplied done/private fields/foreign scopes and bounds suggestions", () => {
  const i = checklistItem(), detail = { category: i.category, title: i.title };
  for (const suggestions of [[], Array(13).fill(detail), [{ ...detail, status: "done" }], [{ ...detail, source: "user" }], [{ ...detail, ownerId: "A" }]]) {
    expect(() => validateChecklistProposal({ tripId: i.tripId, suggestions } as never)).toThrow();
  }
  expect(() => previewChecklistProposal({ tripId: i.id, suggestions: [detail] }, [i])).toThrow();
});
