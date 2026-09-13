import type { TripWorkspaceController } from "../../usecases/trip-plan/trip-workspace-controller";
import { candidateAssessmentView } from "./candidate-assessment-view";
import { candidateCaveatCopy } from "./candidate-caveat-copy";
import { element, control, option } from "./trip-workspace-elements";

export function renderWorkspaceCandidates(controller: TripWorkspaceController, report: (message: string) => void): HTMLElement {
  const section = element("section", "trip-workspace-candidates");
  section.append(element("h2", "", "比較中の候補（旅程には未採用）"));
  for (const entry of controller.candidates()) {
    const card = element("article", "trip-workspace-candidate");
    card.append(element("h3", "", [...entry.candidate.accommodations, ...entry.candidate.experiences].map((o) => o.name).join(" / ") || `経路候補 ${entry.candidate.id}`));
    const a = entry.assessment;
    if (a) {
      card.append(element("p", "", a.weather.target
        ? `一部地点の予報: ${a.weather.target.place.provider} / ${a.weather.target.place.providerPlaceId ?? a.weather.target.place.canonicalKey ?? "地点未確認"}・${a.weather.target.startDate}〜${a.weather.target.endDate}`
        : "天気の対象地点・対象日は未確認（旅行全体の評価ではありません）"));
      for (const label of candidateAssessmentView(a)) card.append(element("p", `assessment-${label.tone}`, label.label));
      if (a.partial) card.append(element("p", "assessment-warning", "一部の情報だけで比較しています"));
      for (const caveat of a.caveats) card.append(element("p", "assessment-warning", candidateCaveatCopy(caveat)));
    } else card.append(element("p", "assessment-warning", "候補の条件・天気・費用は未評価です"));
    const targets = controller.current()?.items.filter((i) => i.type !== "activity") ?? [];
    const label = element("label", "", "変更対象の予定 ");
    const select = element("select");
    select.append(option("予定を選択", ""));
    for (const item of targets) select.append(option(item.title, item.id));
    select.value = controller.uiFocus()?.itemId ?? "";
    label.append(select); card.append(label);
    const choose = (accommodation?: { provider: string; providerItemId: string }) => {
      if (!select.value) { report("先に変更対象の予定を選んでください。"); select.focus(); return; }
      void controller.selectCandidate(entry.candidate.id, select.value, accommodation).catch((error: unknown) => report(error instanceof Error ? error.message : "候補を確認できませんでした"));
    };
    if (entry.candidate.journey) card.append(control("経路を変更案にする", () => choose()));
    for (const offering of entry.candidate.accommodations) card.append(control(`${offering.name}を変更案にする`, () => choose({ provider: offering.provider, providerItemId: offering.providerItemId })));
    section.append(card);
  }
  if (!controller.candidates().length) section.append(element("p", "", "比較中の候補はありません"));
  return section;
}
