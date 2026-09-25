import type { AgentToolDescriptor } from "./tool-contract";

export const weatherToolDescriptor: AgentToolDescriptor = {
  name: "search_weather_forecast",
  description: "目的地の時間別と週間天気予報をEvidence付きで検索します",
  intentPolicy: { dependencies: ["destination", "start_date", "end_date"], requirements: [
    { target: "destination", inputField: "location", necessity: "required", match: "presence" },
    { target: "start_date", inputField: "startDate", necessity: "optional", match: "exact", acceptedPrecisions: ["exact"] },
    { target: "end_date", inputField: "endDate", necessity: "optional", match: "exact", acceptedPrecisions: ["exact"] },
  ] },
  inputSchema: {
      type: "object",
      properties: {
        location: { type: "string", description: "所在地を確認済みの市区町村名。例: 京都市。市と行政区の連結表記は市単位へ正規化するが、施設名・番地・都道府県付き住所から所在地は推測しない。所在地不明なら公開情報で確認する" },
        startDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Requested forecast date, NOT the reference date. For 明日/tomorrow copy featureContext.relativeDates.tomorrow; for 明後日 copy relativeDates.dayAfterTomorrow. 暦日計算済みの参照値から利用者の対象日を選ぶ。省略時は今後7日間" },
        endDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "予報対象の終了日。startDateのみの場合はその1日だけを照会する" },
      },
      required: ["location"],
      additionalProperties: false,
    },
};
