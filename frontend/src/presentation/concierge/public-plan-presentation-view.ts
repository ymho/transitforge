import type { PublicPlanPresentation } from "@raiquora/agent/public-plan-presentation";

export function renderPublicPlanPresentation(value: PublicPlanPresentation): HTMLElement {
  const root = document.createElement("section"); root.className = "public-plan-presentation";
  root.dataset.presentationId = value.presentationId; root.setAttribute("aria-label", "旅の仮行程");
  const navigation = document.createElement("div"); navigation.className = "public-plan-candidate-tabs"; navigation.setAttribute("role", "tablist");
  const panels = value.candidates.map((candidate, index) => {
    const panel = document.createElement("article"); panel.className = "public-plan-candidate"; panel.id = safeId(`${value.presentationId}-${candidate.variantId}`);
    if (value.candidates.length > 1) panel.setAttribute("role", "tabpanel"); panel.hidden = index !== 0;
    const heading = document.createElement("h3"); heading.textContent = value.candidates.length === 1 ? "現地での過ごし方" : candidate.label; panel.append(heading);
    const axes = document.createElement("dl"); axes.className = "public-plan-axes";
    if (candidate.cost?.status === "known" || candidate.cost?.status === "partial")
      axis(axes, "費用の目安", `${formatMinorCurrency(candidate.cost.currency, candidate.cost.amountMinor)}${candidate.cost.status === "partial" ? "（一部）" : ""}`);
    if (candidate.workload?.status === "known") axis(axes, "移動時間", `${candidate.workload.travelMinutes}分`);
    if (axes.childElementCount) panel.append(axes);
    const dayList = document.createElement("ol"); dayList.className = "public-plan-days";
    const items = new Map(candidate.items.map((item) => [item.itemRef, item]));
    for (const day of candidate.days) {
      const dayItem = document.createElement("li"); const dayHeading = document.createElement("h4"); dayHeading.textContent = day.label; dayItem.append(dayHeading);
      if (day.status === "free") dayItem.append(text("予定を入れない自由日"));
      else if (day.status === "not-retrieved") dayItem.append(text("詳細は未取得です"));
      else { const list = document.createElement("ul"); for (const entry of day.entries) { const source = items.get(entry.itemRef); if (!source) continue;
        const item = document.createElement("li"); item.dataset.entryRef = entry.entryRef; item.dataset.itemRef = entry.itemRef;
        item.textContent = `${entryRole(entry.role)}${source.title}`; list.append(item); } dayItem.append(list); }
      dayList.append(dayItem);
    }
    panel.append(dayList);
    if (candidate.scenarioRefs.length) { const scenario = text(`耐性評価: ${candidate.scenarioRefs.length}シナリオ（仮定に基づく比較）`); scenario.className = "public-plan-scenarios"; panel.append(scenario); }
    if (value.candidateSetRef.kind === "candidate-set-ref" && value.target) {
      const candidateSetRef = value.candidateSetRef, target = value.target;
      const adopt = document.createElement("button"); adopt.type = "button"; adopt.className = "public-plan-adopt"; adopt.textContent = "この案を採用する";
      adopt.addEventListener("click", () => adopt.dispatchEvent(new CustomEvent("raiquora:preview-plan-adoption", { bubbles: true, detail: {
        presentationId: value.presentationId, candidateSetId: candidateSetRef.candidateSetId, candidateSetRevision: candidateSetRef.revision,
        variantId: candidate.variantId, tripId: target.tripId, baseTripRevision: target.baseTripRevision,
      } }))); panel.append(adopt);
    }
    return panel;
  });
  value.candidates.forEach((candidate, index) => {
    if (value.candidates.length === 1) return;
    const button = document.createElement("button"); button.type = "button"; button.setAttribute("role", "tab"); button.setAttribute("aria-selected", String(index === 0));
    button.id = `${panels[index]!.id}-tab`; panels[index]!.setAttribute("aria-labelledby", button.id); button.tabIndex = index === 0 ? 0 : -1;
    button.setAttribute("aria-controls", panels[index]!.id); button.textContent = `${index + 1}. ${candidate.label}`;
    const select = () => { panels.forEach((panel, panelIndex) => panel.hidden = panelIndex !== index); for (const tab of navigation.querySelectorAll<HTMLButtonElement>('[role="tab"]')) { const selected = tab === button; tab.setAttribute("aria-selected", String(selected)); tab.tabIndex = selected ? 0 : -1; } };
    button.addEventListener("click", select);
    button.addEventListener("keydown", (event) => { const tabs = [...navigation.querySelectorAll<HTMLButtonElement>('[role="tab"]')]; let next: number | undefined;
      if (event.key === "ArrowRight") next = (index + 1) % value.candidates.length; else if (event.key === "ArrowLeft") next = (index - 1 + value.candidates.length) % value.candidates.length;
      else if (event.key === "Home") next = 0; else if (event.key === "End") next = value.candidates.length - 1; if (next === undefined) return;
      event.preventDefault(); tabs[next]?.click(); tabs[next]?.focus(); });
    navigation.append(button);
  });
  if (value.candidates.length > 1) root.append(navigation);
  root.append(...panels);
  if (value.researchOutcome.effectiveMode === "standard" && value.candidateSetRef.kind === "candidate-set-ref") { const detail = document.createElement("button"); detail.type = "button"; detail.textContent = "さらに詳しく比較する";
    detail.addEventListener("click", () => detail.dispatchEvent(new CustomEvent("raiquora:detailed-research", { bubbles: true, detail: { presentationId: value.presentationId,
      ...(value.candidateSetRef.kind === "candidate-set-ref" ? { candidateSetId: value.candidateSetRef.candidateSetId, candidateSetRevision: value.candidateSetRef.revision,
        ...(value.candidateSetRef.baseTripRevision === undefined ? {} : { baseTripRevision: value.candidateSetRef.baseTripRevision }) } : {}),
      ...(value.target ? { tripId: value.target.tripId, baseTripRevision: value.target.baseTripRevision } : {}) } }))); root.append(detail); }
  return root;
}

function axis(parent: HTMLElement, name: string, value: string) { const dt = document.createElement("dt"), dd = document.createElement("dd"); dt.textContent = name; dd.textContent = value; parent.append(dt, dd); }
function text(value: string) { const node = document.createElement("p"); node.textContent = value; return node; }
function safeId(value: string) { return `plan-${value.replace(/[^A-Za-z0-9_-]/gu, "-")}`; }
function entryRole(role: string) { return role === "continue" ? "滞在中: " : role === "end" ? "終了/到着: " : role === "start" ? "開始/出発: " : role === "possible" ? "候補: " : ""; }
function formatMinorCurrency(currency?: string, amountMinor?: number): string {
  if (!currency || amountMinor === undefined) return "未確認";
  try {
    const fraction = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
    return new Intl.NumberFormat("ja-JP", { style: "currency", currency }).format(amountMinor / 10 ** fraction);
  } catch { return `${currency} 金額単位未確認`; }
}
