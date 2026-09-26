# Temporary development migration; removed before final PR diff.
from pathlib import Path
r=Path.cwd()
p=r/'frontend/src/presentation/concierge/travel-profile-panel.ts';s=p.read_text();a=s.index('type Section =');b=s.index('\n/** Account',a)
s=s[:a]+'''const profileSections = ["origin", "interests", "pace", "notes"] as const;
type Section = typeof profileSections[number];
'''+s[b:]
s=s.replace('["origin", "interests", "pace", "stay-food", "avoidances"] as const','profileSections')
a=s.index('    ${section("origin", "出発地・移動"');b=s.index('    ${section("interests"',a)
s=s[:a]+'''    ${section("origin", "普段の出発地", sectionSummary("origin", draft), field("station", "駅・エリア", profileOrigin(draft)), true)}
'''+s[b:]
a=s.index('    ${section("pace", "ペース・移動の好み"');b=s.index('    <p class="profile-consent-explanation"',a)
s=s[:a]+'''    ${section("pace", "ペース", sectionSummary("pace", draft), choice("pace", "1日の過ごし方", draft.travelStyle.pace, ["ゆっくり", "ほどほど", "しっかり"] ))}
    ${section("notes", "配慮してほしいこと", sectionSummary("notes", draft), `<div class="profile-field-grid">${note("lodging", "宿泊の好み", draft)}${note("food", "食事の好み", draft)}${note("avoidances", "避けたいこと", draft)}</div>`)}
'''+s[b:]
a=s.index('  if (section === "origin") return');b=s.index('\nfunction field(',a)
s=s[:a]+'''  if (section === "origin") return profileOrigin(draft) || "未設定";
  if (section === "interests") return (Object.entries(draft.preferences) as Array<[keyof typeof travelPreferenceLabels, number]>).filter(([, value]) => value >= .7).map(([key]) => travelPreferenceLabels[key]).join("・") || "未設定";
  if (section === "pace") return draft.travelStyle.pace === undefined ? "未設定" : draft.travelStyle.pace < .35 ? "ゆっくり" : draft.travelStyle.pace < .7 ? "ほどほど" : "しっかり";
  return [draft.notes?.lodging ? "宿泊" : undefined, draft.notes?.food ? "食事" : undefined, draft.notes?.avoidances ? "配慮事項" : undefined].filter(Boolean).join("・") || "未設定";
}
function profileOrigin(draft: Draft): string { return draft.home.station?.trim() || draft.home.area?.trim() || ""; }
'''+s[b:]
a=s.index('  draft.home.station = text("station")');b=s.index('  for (const key of Object.keys(travelPreferenceLabels)',a)
s=s[:a]+'''  // Preserve the two legacy origin fields unless the visible origin was edited.
  // An explicit clear must also remove the hidden area fallback.
  if (text("station") !== profileOrigin(previous)) {
    draft.home.station = text("station") || undefined;
    draft.home.area = undefined;
  }
  if (text("pace")) draft.travelStyle.pace = Number(text("pace")); else delete draft.travelStyle.pace;
  // Hidden old mobility/tolerance, party and budget fields round-trip unchanged.
'''+s[b:]
s=s.replace('  draft.transport.preferredMode = (text("mode") || undefined) as UserProfile["transport"]["preferredMode"];\n','');p.write_text(s)
p=r/'modules/agent/runtime/effective-intent.ts';s=p.read_text();a=s.index('  if (profile.transport.preferredMode) add(');b=s.index('  for (const key of ["lodging", "food", "avoidances"]',a)
s=s[:a]+'''  // The editable always-on profile is origin, interests, pace and consented notes.
  // Hidden old mobility/tolerance settings remain stored, but do not silently steer AI.
'''+s[b:];p.write_text(s)
p=r/'frontend/src/presentation/concierge/travel-profile-panel.test.ts';s=p.read_text().replace('toHaveLength(5)','toHaveLength(4)')
s+='''

it("shows only origin, interests, pace and consented notes without rewriting hidden legacy preferences", async () => {
  const old: UserProfile = { ...profile, home: { area: "神戸", carAvailable: true },
    travelStyle: { pace: .45, novelty: .8, walkingTolerance: .65, crowdTolerance: .2 },
    transport: { preferredMode: "car", maxTypicalTravelMinutes: 120 },
    notes: { budget: "旧予算", lodging: "古いメモ", food: "食事メモ", avoidances: "配慮メモ" }, aiNoteFields: ["lodging"] };
  const update = vi.fn(async (next: UserProfile) => ({ profile: next, revision: 4 }));
  const controller = new ProfileUiController({ get: vi.fn(async () => ({ profile: old, revision: 3 })), update, delete: vi.fn() });
  await controller.hydrate(); configureTravelProfile(document, controller);
  expect(document.querySelectorAll("[data-profile-section]")).toHaveLength(4);
  for (const name of ["area", "mode", "car", "walkingTolerance", "crowdTolerance", "transferTolerance", "earlyMorningTolerance", "lateNightTolerance", "drivingTolerance", "busTolerance"])
    expect(document.querySelector(`[name="${name}"]`)).toBeNull();
  expect(document.querySelector<HTMLInputElement>('[name="station"]')?.value).toBe("神戸");
  document.querySelector<HTMLButtonElement>('[data-choice="interest-food"]')!.click();
  await vi.waitFor(() => expect(update).toHaveBeenCalledOnce());
  const saved = update.mock.calls[0]![0];
  expect(saved.home).toEqual(old.home);
  expect(saved.travelStyle).toEqual(old.travelStyle);
  expect(saved.transport).toEqual(old.transport);
  expect(saved.notes).toEqual(old.notes);
  expect(saved.aiNoteFields).toEqual(["lodging"]);
  expect(saved.companions).toEqual(old.companions);
});

it("clears the represented origin without reviving a hidden area fallback", async () => {
  const old: UserProfile = { ...profile, home: { station: "京都駅", area: "京都", carAvailable: true } };
  const update = vi.fn(async (next: UserProfile) => ({ profile: next, revision: 4 }));
  const controller = new ProfileUiController({ get: vi.fn(async () => ({ profile: old, revision: 3 })), update, delete: vi.fn() });
  await controller.hydrate(); configureTravelProfile(document, controller);
  const station = document.querySelector<HTMLInputElement>('[name="station"]')!;
  station.value = ""; station.dispatchEvent(new Event("change", { bubbles: true }));
  await vi.waitFor(() => expect(update).toHaveBeenCalledOnce());
  expect(update.mock.calls[0]![0].home).toEqual({ station: undefined, area: undefined, carAvailable: true });
});
''';p.write_text(s)
p=r/'modules/agent/runtime/effective-intent.test.ts';s=p.read_text().replace('expect(JSON.stringify(context)).toContain("0.65");','expect(JSON.stringify(context)).not.toContain("0.65");\n    expect(profile.travelStyle.walkingTolerance).toBe(0.65);\n    expect(effective.profileHints.some(({ attribute }) => attribute.startsWith("mobility:") || attribute.startsWith("tolerance:"))).toBe(false);')
s+='''

it("keeps unconsented notes and hidden legacy preferences out of model input without deleting saved data", () => {
  const profile = userProfile();
  profile.notes = { ...profile.notes, lodging: "PRIVATE_LODGING_NOTE", avoidances: "PRIVATE_AVOID_NOTE" };
  const original = structuredClone(profile);
  const effective = compileEffectiveIntent({ profile, overlay: emptyConversationIntentOverlay() });
  expect(JSON.stringify(effective)).not.toContain("PRIVATE_LODGING_NOTE");
  expect(JSON.stringify(effective)).not.toContain("PRIVATE_AVOID_NOTE");
  expect(effective.profileHints.map(({ attribute }) => attribute).sort()).toEqual(["interest:food", "interest:history", "interest:nature", "note:food", "origin", "pace"]);
  expect(profile).toEqual(original);
});
''';p.write_text(s)
