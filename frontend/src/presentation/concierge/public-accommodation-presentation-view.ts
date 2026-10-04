import { parsePublicAccommodationPresentation, type PublicAccommodationPresentation } from "@raiquora/agent/public-accommodation-presentation";
import type { PublicPlanPresentation } from "@raiquora/agent/public-plan-presentation";
import { renderPublicPlanPresentation } from "./public-plan-presentation-view";

export function renderPublicAccommodationPresentation(input: PublicAccommodationPresentation, plan?: PublicPlanPresentation): HTMLElement {
  const value = parsePublicAccommodationPresentation(input);
  const section = document.createElement("section"); section.className = "public-accommodation-presentation"; section.setAttribute("aria-label", "宿泊候補の比較");
  const combined = plan && canCombineAccommodationPlan(value, plan) ? plan : undefined;
  const actions = combined ? renderPublicPlanPresentation(combined) : undefined;
  const tabs = document.createElement("div"); tabs.className = "public-plan-candidate-tabs"; tabs.setAttribute("role", "tablist"); tabs.setAttribute("aria-label", "宿泊候補");
  const panels: HTMLElement[] = [];
  for (const [index, hotel] of value.cards.entries()) {
    const card = document.createElement("article"); card.className = "public-place-card";
    const name = document.createElement("h3"); name.textContent = hotel.name;
    const summary = document.createElement("p"); summary.style.whiteSpace = "pre-line"; summary.textContent = hotel.summary;
    const observed = document.createElement("p"); observed.textContent = `取得日時: ${new Date(hotel.retrievedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}（日本時間）`;
    card.append(name, summary, observed);
    if (hotel.sourceUrl) { const source = document.createElement("a"); source.href = hotel.sourceUrl; source.target = "_blank"; source.rel = "noopener noreferrer"; source.textContent = "宿の詳細・最新料金を確認 ↗"; card.append(source); }
    if (combined && actions) {
      const candidateIndex = combined.candidates.findIndex(candidate => candidate.items[0]!.sourceRef === hotel.evidenceId);
      const candidate = combined.candidates[candidateIndex]!;
      const source = actions.querySelectorAll<HTMLElement>(".public-plan-candidate")[candidateIndex]!;
      const adopt = source.querySelector(".public-plan-adopt");
      if (adopt) card.append(adopt);
      if (candidate.unknowns.length) {
        const details = document.createElement("details"), label = document.createElement("summary"), unknowns = document.createElement("p");
        label.textContent = "旅程への反映条件"; unknowns.textContent = `未確認: ${candidate.unknowns.join("・")}`; details.append(label, unknowns); card.append(details);
      }
      card.classList.add("public-plan-candidate"); card.hidden = index !== 0;
      if (value.cards.length > 1) {
        card.id = `hotel-${combined.presentationId.replace(/[^A-Za-z0-9_-]/gu, "-")}-${index}`; card.setAttribute("role", "tabpanel");
        const tab = document.createElement("button"); tab.type = "button"; tab.textContent = `候補 ${index + 1}`; tab.setAttribute("role", "tab");
        tab.id = `${card.id}-tab`; tab.setAttribute("aria-controls", card.id); card.setAttribute("aria-labelledby", tab.id);
        tab.setAttribute("aria-selected", String(index === 0)); tab.tabIndex = index === 0 ? 0 : -1;
        tab.addEventListener("click", () => {
          panels.forEach((panel, i) => panel.hidden = i !== index);
          for (const button of tabs.querySelectorAll<HTMLButtonElement>("button")) { button.setAttribute("aria-selected", String(button === tab)); button.tabIndex = button === tab ? 0 : -1; }
        });
        tab.addEventListener("keydown", event => {
          const buttons = [...tabs.querySelectorAll<HTMLButtonElement>("button")];
          const next = event.key === "ArrowRight" ? (index + 1) % buttons.length : event.key === "ArrowLeft" ? (index - 1 + buttons.length) % buttons.length : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : undefined;
          if (next === undefined) return; event.preventDefault(); buttons[next]?.click(); buttons[next]?.focus();
        });
        tabs.append(tab);
      }
    }
    panels.push(card);
    section.append(card);
  }
  if (tabs.childElementCount) section.prepend(tabs);
  const detailed = actions?.querySelector<HTMLButtonElement>(".public-plan-presentation > button");
  if (detailed) { detailed.classList.add("public-plan-detail"); section.append(detailed); }
  return section;
}

/** Exact published observation binding only; composite or unbound plans stay separate. */
export function canCombineAccommodationPlan(hotels: PublicAccommodationPresentation, plan: PublicPlanPresentation): boolean {
  const ids = new Set(hotels.cards.map(card => card.evidenceId));
  return ids.size === hotels.cards.length && plan.candidateSetRef.kind === "candidate-set-ref" && !!plan.target &&
    plan.candidates.length === ids.size && new Set(plan.candidates.map(candidate => candidate.items[0]?.sourceRef)).size === ids.size &&
    plan.candidates.every(candidate => candidate.items.length === 1 && candidate.items[0]!.kind === "stay" &&
      ids.has(candidate.items[0]!.sourceRef) && candidate.days.length > 0 && candidate.days.every(day => day.status === "planned" &&
        day.entries.length === 1 && day.entries[0]!.itemRef === candidate.items[0]!.itemRef) &&
      !candidate.scenarioRefs.length && !candidate.comparisonAssessmentRefs.length &&
      candidate.cost?.status !== "known" && candidate.cost?.status !== "partial" && (!candidate.workload || candidate.workload.status === "unknown"));
}
