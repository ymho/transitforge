import type { PublicJourneyPresentation } from "@raiquora/agent/public-journey-presentation";

/** JourneyCard renders only the public Application projection, never Tool output. */
export function renderPublicJourneyPresentation(value: PublicJourneyPresentation): HTMLElement {
  const section = document.createElement("section"); section.className = "journey-presentation"; section.setAttribute("aria-label", `${value.originStation}から${value.destinationStation}の経路候補`);
  const heading = document.createElement("header");
  heading.innerHTML = `<small>${escapeHtml(value.serviceDate)}</small><h2>${escapeHtml(value.originStation)} <span aria-hidden="true">→</span> ${escapeHtml(value.destinationStation)}</h2>`;
  section.append(heading);
  const tabs = document.createElement("div"); tabs.className = "journey-presentation-tabs"; tabs.setAttribute("role", "tablist"); tabs.setAttribute("aria-label", "経路候補");
  const panels: HTMLElement[] = [];
  for (const [index, journey] of value.journeys.entries()) {
    const tab = document.createElement("button"); tab.type = "button"; tab.className = "ds-button"; tab.setAttribute("role", "tab"); tab.setAttribute("aria-selected", String(index === 0)); tab.textContent = `候補 ${index + 1}`;
    const card = document.createElement("article"); card.className = "journey-card ds-surface";
    card.hidden = index !== 0;
    card.innerHTML = `<header><span>候補 ${index + 1}</span><strong>${escapeHtml(journey.departureTime)}–${escapeHtml(journey.arrivalTime)}</strong><small>${journey.durationMinutes}分・乗換${journey.transferCount}回</small></header>`;
    const legs = document.createElement("ol"); legs.className = "journey-card-legs";
    for (const leg of journey.legs) {
      const item = document.createElement("li");
      item.innerHTML = `<div class="journey-card-time"><strong>${escapeHtml(leg.departureTime)}</strong><span>${escapeHtml(leg.arrivalTime)}</span></div><div class="journey-card-route"><strong>${escapeHtml(leg.originStation)} → ${escapeHtml(leg.destinationStation)}</strong><span>${escapeHtml([leg.serviceType, leg.trainName, leg.trainNumber].filter(Boolean).join(" "))}${leg.serviceDestination ? `・${escapeHtml(leg.serviceDestination)}行` : ""}</span>${leg.delayStatus ? `<small class="journey-delay"${leg.delayBasis ? ` title="${escapeHtml(leg.delayBasis)}"` : ""}>${leg.delayMinutes}分遅れ（${leg.delayStatus === "observed" ? "確認値" : "推定"}）</small>` : ""}${leg.transferWaitMinutes !== undefined ? `<small class="journey-transfer-wait">${escapeHtml(leg.destinationStation)}で${leg.transferWaitMinutes}分乗換</small>` : ""}</div>`;
      legs.append(item);
    }
    card.append(legs); panels.push(card); tabs.append(tab); section.append(card);
    tab.addEventListener("click", () => { for (const [candidateIndex, panel] of panels.entries()) panel.hidden = candidateIndex !== index; for (const candidate of tabs.querySelectorAll('[role="tab"]')) candidate.setAttribute("aria-selected", String(candidate === tab)); });
  }
  if (value.journeys.length > 1) heading.after(tabs);
  const source = document.createElement("p"); source.className = "journey-source-disclosure"; source.textContent = "時刻・列車・乗換は検証済み検索結果を表示しています。"; section.append(source);
  return section;
}
function escapeHtml(value: string): string { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
