import { parsePublicGroundRoutePresentation, type PublicGroundRoutePresentation } from "@raiquora/agent/public-ground-route-presentation";

/** A searched route preview, kept separate from the persisted Trip overlay. */
export function renderPublicGroundRoutePresentation(value: PublicGroundRoutePresentation,
  showOnMap?: (route: PublicGroundRoutePresentation, index: number) => void): HTMLElement {
  const presentation = parsePublicGroundRoutePresentation(value);
  const section = document.createElement("section");
  section.setAttribute("aria-label", "徒歩・バスの経路候補");
  const heading = document.createElement("h3"); heading.textContent = `${presentation.originName} → ${presentation.destinationName}`;
  section.append(heading);
  presentation.routes.forEach((route, index) => {
    const article = document.createElement("article");
    const title = document.createElement("h4");
    title.textContent = `${localTime(route.departureAt)}発 → ${localTime(route.arrivalAt)}着（${route.durationMinutes}分・予定）`;
    const list = document.createElement("ol");
    for (const [legIndex, leg] of route.legs.entries()) {
      if (route.via?.afterLegIndex === legIndex) {
        const pause = document.createElement("li"); pause.textContent = `${route.via.name}で滞在${route.via.stayMinutes}分（仮定・営業未確認）`;
        list.append(pause);
      }
      const entry = document.createElement("li");
      entry.textContent = `${leg.mode === "bus" ? `バス${leg.routeName ? ` ${leg.routeName}` : ""}` : "徒歩"}：${leg.originName} → ${leg.destinationName}（${localTime(leg.departureAt)}–${localTime(leg.arrivalAt)}）`;
      list.append(entry);
    }
    article.append(title, list);
    if (route.via) {
      const assessment = document.createElement("p");
      assessment.textContent = route.via.nextDeadlineAssessment === "fits_next_deadline" ? "次の予定の既知の時刻までに到着する候補です。" :
        route.via.nextDeadlineAssessment === "arrives_after_next_deadline" ? "次の予定の既知の時刻に間に合いません。" : "次の予定の時刻は未確認です。";
      article.append(assessment);
    }
    if (showOnMap) {
      const button = document.createElement("button"); button.type = "button"; button.textContent = "地図に表示";
      button.addEventListener("click", () => showOnMap(presentation, index)); article.append(button);
    }
    section.append(article);
  });
  const source = document.createElement("p");
  const link = document.createElement("a"); link.href = presentation.sourceUrl; link.target = "_blank";
  link.rel = "noopener noreferrer"; link.textContent = `運行データ: ${presentation.attribution}`;
  source.append(link, `（取得 ${presentation.feedRetrievedAt.slice(0, 10)}、検索 ${presentation.checkedAt.slice(0, 10)}）。現行の運行・乗車・営業は再確認してください。旅程には未採用です。`);
  section.append(source);
  return section;
}
function localTime(value: string): string { return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value)); }
