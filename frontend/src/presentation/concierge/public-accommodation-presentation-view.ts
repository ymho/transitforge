import "./public-accommodation-presentation.css";
import { parsePublicAccommodationPresentation, type PublicAccommodationPresentation } from "@raiquora/agent/public-accommodation-presentation";
import type { PublicPlanPresentation } from "@raiquora/agent/public-plan-presentation";
import { renderPublicPlanPresentation } from "./public-plan-presentation-view";

export function renderPublicAccommodationPresentation(input: PublicAccommodationPresentation, plan?: PublicPlanPresentation): HTMLElement {
  const value = parsePublicAccommodationPresentation(input);
  const section = document.createElement("section"); section.className = "public-accommodation-presentation"; section.setAttribute("aria-label", "宿泊候補の比較");
  const combined = plan && canCombineAccommodationPlan(value, plan) ? plan : undefined;
  const actions = combined ? renderPublicPlanPresentation(combined, { detailedResearch: false }) : undefined;

  const panels: HTMLElement[] = [];
  for (const [index, hotel] of value.cards.entries()) {
    const card = document.createElement("article"); card.className = "public-place-card";
    const name = document.createElement("h3"); name.textContent = hotel.name;
    if (hotel.imageUrl) {
      const photo = document.createElement("img"); photo.className = "accommodation-photo"; photo.src = hotel.imageUrl;
      photo.alt = hotel.name; photo.loading = "lazy"; photo.referrerPolicy = "no-referrer";
      photo.addEventListener("error", () => photo.remove()); card.append(photo);
    }
    card.append(name);
    const facts = document.createElement("dl"); facts.className = "accommodation-facts";
    const notices: string[] = [];
    const addFact = (label: string, value: string) => {
      const term = document.createElement("dt"), detail = document.createElement("dd"); term.textContent = label; detail.textContent = value; facts.append(term, detail);
    };
    for (const line of hotel.summary.split("\n").filter(Boolean)) {
      if (/^評価[:：]/u.test(line)) continue;
      if (/空室|未確認/u.test(line)) { notices.push(line); continue; }
      const price = line.match(/^(.*?料金|参考最安値|参考最低料金)[:：]\s*(.*?)(?:（(.*?)）)?$/u);
      if (price) { addFact(price[1]!, price[2]!); if (price[3]) notices.push(price[3]); continue; }
      const labeled = line.match(/^([^:：]+)[:：]\s*(.*)$/u);
      if (labeled) addFact(labeled[1]!, labeled[2]!);
      else if (/^\d{4}-\d{2}-\d{2}〜/u.test(line)) addFact("宿泊日", line);
      else addFact("情報", line);
    }
    const legacyRating = hotel.summary.match(/^評価[:：]\s*([0-5](?:\.\d+)?)\/5$/mu);
    const rating = hotel.reviewAverage ?? (legacyRating ? Number(legacyRating[1]) : undefined);
    if (rating !== undefined && rating >= 0 && rating <= 5) {
      const term = document.createElement("dt"), detail = document.createElement("dd"), stars = document.createElement("span"), fill = document.createElement("span");
      term.textContent = "評価"; detail.className = "accommodation-rating"; stars.className = "accommodation-stars";
      stars.setAttribute("aria-hidden", "true"); stars.textContent = "★★★★★"; fill.textContent = "★★★★★"; fill.style.width = `${Number((rating * 20).toFixed(2))}%`; stars.append(fill);
      detail.setAttribute("aria-label", `5点満点中${rating}`); detail.append(stars, document.createTextNode(` ${rating.toFixed(2)}`)); facts.append(term, detail);
    }
    card.append(facts);
    if (notices.length) {
      const notice = document.createElement("aside"), title = document.createElement("strong"), content = document.createElement("p");
      notice.className = "accommodation-notice"; title.textContent = "お知らせ"; content.textContent = notices.join("。\n"); notice.append(title, content); card.append(notice);
    }
    const controls = document.createElement("div"); controls.className = "accommodation-actions"; card.append(controls);
    if (hotel.sourceUrl) { const source = document.createElement("a"); source.className = "accommodation-source-link"; source.href = hotel.sourceUrl; source.target = "_blank"; source.rel = "noopener noreferrer"; source.textContent = "宿の詳細・最新料金を確認 ↗"; controls.append(source); }
    const footer = document.createElement("footer"); footer.className = "accommodation-footer";
    const observed = document.createElement("small"); observed.textContent = `取得: ${new Date(hotel.retrievedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}（日本時間）`; footer.append(observed);
    if (hotel.provider === "rakuten-travel") {
      const credit = document.createElement("a"), logo = document.createElement("img"); credit.href = "https://travel.rakuten.co.jp/"; credit.target = "_blank"; credit.rel = "noopener noreferrer";
      credit.className = "accommodation-credit"; logo.src = import.meta.env.VITE_ACCOMMODATION_PROVIDER_CREDIT_IMAGE_URL || "https://webservice.rakuten.co.jp/img/credit/200709/credit_22121.gif";
      logo.alt = "楽天トラベル"; logo.loading = "lazy"; logo.addEventListener("error", () => { credit.textContent = "楽天トラベル"; }); credit.append(logo); footer.append(credit);
    }
    card.append(footer);
    if (combined && actions) {
      const candidateIndex = combined.candidates.findIndex(candidate => candidate.items[0]!.sourceRef === hotel.evidenceId);
      const candidate = combined.candidates[candidateIndex]!;
      const source = actions.querySelectorAll<HTMLElement>(".public-plan-candidate")[candidateIndex]!;
      const adopt = source.querySelector(".public-plan-adopt");
      if (adopt) controls.prepend(adopt);
      if (candidate.unknowns.length) {
        const details = document.createElement("details"), label = document.createElement("summary"), unknowns = document.createElement("p");
        label.textContent = "旅程への反映条件"; unknowns.textContent = `未確認: ${candidate.unknowns.join("・")}`; details.append(label, unknowns); card.append(details);
      }
      card.classList.add("public-plan-candidate");
    }
    card.hidden = index !== 0;
    panels.push(card);
    section.append(card);
  }
  if (panels.length > 1) {
    const navigation = document.createElement("nav"); navigation.className = "accommodation-navigation"; navigation.setAttribute("aria-label", "宿泊候補の切り替え");
    const previous = document.createElement("button"), next = document.createElement("button"), position = document.createElement("span");
    previous.type = next.type = "button"; previous.textContent = "←"; next.textContent = "→";
    previous.setAttribute("aria-label", "前の宿泊候補"); next.setAttribute("aria-label", "次の宿泊候補");
    position.setAttribute("aria-live", "polite");
    let current = 0;
    const show = (index: number) => {
      current = Math.max(0, Math.min(panels.length - 1, index));
      panels.forEach((panel, i) => { panel.hidden = i !== current; });
      position.textContent = `${current + 1} / ${panels.length}`;
      previous.disabled = current === 0; next.disabled = current === panels.length - 1;
    };
    previous.addEventListener("click", () => show(current - 1)); next.addEventListener("click", () => show(current + 1));
    navigation.addEventListener("keydown", event => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault(); show(current + (event.key === "ArrowRight" ? 1 : -1));
    });
    navigation.append(previous, position, next); section.prepend(navigation); show(0);
  }
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
