export interface SemanticMultiTurnExpected {
  scenarioId: string;
  expectedIntentRevision: number;
  facts: Array<{ target: string; frame: "actual" | "hypothetical"; scopeKind?: string; modality?: string;
    kind?: string; text?: string; label?: string; amount?: number }>;
  tombstoneTarget?: string;
}

const expected: SemanticMultiTurnExpected[] = [];
for (const [index, label] of ["富山", "倉敷", "京都"].entries())
  expected.push({ scenarioId: `correction-0${index + 1}`, expectedIntentRevision: 2, facts: [{ target: "destination", frame: "actual", label }] });
for (const [index, values] of [["歴史", "食事"], ["自然", "温泉"], ["美術館", "建築"]].entries())
  expected.push({ scenarioId: `interest-addition-0${index + 1}`, expectedIntentRevision: 2,
    facts: values.map((text) => ({ target: "experience", frame: "actual", text })) });
for (const [index, values] of [["のんびり", "活発"], ["活発", "ゆったり"], ["標準ペース", "のんびり"]].entries())
  expected.push({ scenarioId: `day-scope-0${index + 1}`, expectedIntentRevision: 2, facts: [
    { target: "pace", frame: "actual", text: values[0] }, { target: "pace", frame: "actual", text: values[1], scopeKind: "logical_day" },
  ] });
for (let index = 0; index < 3; index += 1)
  expected.push({ scenarioId: `origin-retraction-0${index + 1}`, expectedIntentRevision: 2, facts: [], tombstoneTarget: "origin" });
for (const [index, values] of [[1, 2], [2, 3], [50_000, 80_000]].entries())
  expected.push({ scenarioId: `hypothetical-0${index + 1}`, expectedIntentRevision: 2,
    facts: values.map((value, frameIndex) => ({ target: ["party_size", "duration", "budget", "transport", "accommodation"][index]!,
      frame: frameIndex === 0 ? "actual" : "hypothetical", ...(typeof value === "number" ? { amount: value } : { text: value }) })) });
for (const [index, label] of ["出雲大社", "高山", "広島"].entries())
  expected.push({ scenarioId: `question-0${index + 1}`, expectedIntentRevision: 1, facts: [{ target: "destination", frame: "actual", label }] });
for (const [index, [target, text, modality]] of [["experience", "温泉", "acceptable"], ["experience", "美術館", "acceptable"],
  ["fixed_schedule", "早朝出発", "avoid"]].entries())
  expected.push({ scenarioId: `modality-0${index + 1}`, expectedIntentRevision: 2,
    facts: [{ target, frame: "actual", text, modality }] });
for (let index = 0; index < 3; index += 1)
  expected.push({ scenarioId: `relative-date-0${index + 1}`, expectedIntentRevision: 2,
    facts: [{ target: "start_date", frame: "actual", kind: index === 2 ? "local_month" : "local_date" }] });
for (const [index, labels] of [["金沢", "富山"], ["松江", "出雲"], ["奈良", "京都"]].entries())
  expected.push({ scenarioId: `destination-alternative-0${index + 1}`, expectedIntentRevision: 2,
    facts: labels.map((label) => ({ target: "destination", frame: "actual" as const, label })) });
for (const [index, target] of ["origin", "duration", "budget"].entries())
  expected.push({ scenarioId: `explicit-unknown-0${index + 1}`, expectedIntentRevision: 2,
    facts: [{ target, frame: "actual", kind: "unknown" }] });

export const semanticMultiTurnExpected: readonly SemanticMultiTurnExpected[] = expected;
