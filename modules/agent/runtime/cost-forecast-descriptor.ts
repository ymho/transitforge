import type { AgentToolDescriptor } from "./tool-contract";
export const costForecastDescriptor: AgentToolDescriptor = {
  name: "propose_trip_costs",
  description: "現在のTripの交通・宿泊・観光・食事のAI概算を4項目で提案する。金額は今回の利用者全員分、旅行全体分。日程・人数・泊数が不明ならassumptionsに明記し、推定不能ならamountを省略して理由をexplanationへ書く。amountMinorは通貨の最小単位（JPYは円、EUR/CHF/USD/GBPは100分の1、KWDは1000分の1）の非負整数。合計はApplicationが計算。予約価格・支払済み・確認済み価格・価格保証ではなく概算と説明する。既存のユーザー編集は保持される。Trip ID、生成時刻、revision、上書き額はApplicationが決定し入力不可。保存には利用者の確認が必要。",
  inputSchema: { type: "object", properties: { items: { type: "array", minItems: 4, maxItems: 4, items: { type: "object", properties: {
    category: { type: "string", enum: ["transport", "accommodation", "sightseeing", "food"] },
    amount: { type: "object", properties: { currency: { type: "string", enum: ["JPY", "EUR", "CHF", "USD", "GBP", "KWD"] }, amountMinor: { type: "integer", minimum: 0 } }, required: ["currency", "amountMinor"], additionalProperties: false },
    explanation: { type: "string", minLength: 1, maxLength: 240 }, assumptions: { type: "array", maxItems: 6, items: { type: "string", minLength: 1, maxLength: 240 } },
  }, required: ["category", "explanation", "assumptions"], additionalProperties: false } } }, required: ["items"], additionalProperties: false },
};
