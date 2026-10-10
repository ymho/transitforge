import type { AgentToolDescriptor } from "./tool-contract";
export const accommodationToolDescriptor: AgentToolDescriptor = {
 name: "search_accommodations",
 description: "宿泊施設を提案・比較するために実際の宿の候補を検索する。直前の宿泊施設の提案への承諾もこのToolを使う。通常limit=10。目的地が現在条件に未登録なら、今回明示された実際の行き先をupdate_current_destinationで受理してから検索する。precondition_missingは条件不足であり検索障害ではない。recovery.targetを確認し、不足条件を受理できなければ利用者へ具体的な登録方法を案内する。受理済みの開始日と泊数から検索用checkOutDateを計算でき、終了日の条件更新は不要。人数未定ならadultsは省略できる。結果の宿名またはaccommodationSummaryのreplyReferencesを最終回答へ選ぶと、Applicationが複数の比較カードを表示する。空室未確認と参考最安値を確定的な空室・旅行全体の料金にしない。",
 intentPolicy: { dependencies: ["destination", "start_date", "end_date", "duration", "party_size", "accommodation", "budget"], requirements: [
   { target: "destination", inputField: "destination", necessity: "required", match: "presence" },
   { target: "start_date", inputField: "checkInDate", necessity: "optional", match: "exact", acceptedPrecisions: ["exact"] },
   { target: "end_date", inputField: "checkOutDate", necessity: "optional", match: "exact", acceptedPrecisions: ["exact"] },
 ] },
 inputSchema: {
      type: "object",
      properties: {
        destination: {
          type: "string",
          description: "宿泊する地域または観光地。現在の旅程を変更する場合も省略しない",
        },
        checkInDate: {
          type: "string",
          description: "チェックイン日。YYYY-MM-DD形式",
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
        },
        checkOutDate: {
          type: "string",
          description: "チェックアウト日。YYYY-MM-DD形式でcheckInDateより後",
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
        },
        adults: { type: "integer", minimum: 1, maximum: 10 },
        children: { type: "integer", minimum: 0, maximum: 10 },
        considerations: {
          type: "array",
          maxItems: 8,
          items: { type: "string" },
        },
        limit: { type: "integer", minimum: 1, maximum: 10 },
      },
      required: ["destination", "checkInDate", "checkOutDate"],
      additionalProperties: false,
    }
};
