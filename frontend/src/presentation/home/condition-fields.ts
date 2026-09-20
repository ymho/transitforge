import type { TripRequirement } from "@raiquora/trip/trip-request";
import { boundedConditionText, type EditableCondition } from "../../usecases/trip-plan/edit-trip-conditions";
import { currencyMinorUnits, isCurrencyCode } from "@raiquora/trip/money";

export interface ConditionField { key: string; label: string; value: string; type?: string; options?: readonly (readonly [string, string])[] }
export const conditionKinds: readonly (readonly [EditableCondition, string])[] = [["origin", "出発地"], ["destinations", "行き先"], ["dates", "日程"], ["duration", "泊数・日数"], ["mobility", "移動"], ["pace", "ペース"], ["budget", "予算"], ["experience", "好み・避けたいこと"]];
export function conditionFields(type: EditableCondition, current?: TripRequirement): { fields: ConditionField[]; parse(values: Record<string, string>): TripRequirement } {
  const r = current?.type === type ? current : undefined;
  const text = (key: string, label: string, value = "", type = "text"): ConditionField => ({ key, label, value, type });
  const select = (key: string, label: string, value: string, options: ConditionField["options"]): ConditionField => ({ key, label, value, options });
  const integer = (v: string) => { if (!/^\d+$/.test(v)) throw new Error("0以上の整数を入力してください"); return Number(v); };
  const transferCount = (v: string): 0 | 1 | 2 | 3 => { const n = integer(v); if (n !== 0 && n !== 1 && n !== 2 && n !== 3) throw new Error("乗換回数は0〜3で入力してください"); return n; };
  switch (type) {
    case "origin": return { fields: [text("name", "出発地", r?.type === "origin" ? r.place.name : "")], parse: (v) => ({ type, place: { name: boundedConditionText(v.name!), sources: [] } }) };
    case "destinations": return { fields: [text("names", "行き先（カンマ区切り）", r?.type === "destinations" ? r.places.map((p) => p.name).join(",") : ""), select("order", "訪問順", r?.type === "destinations" ? r.order : "flexible", [["flexible", "順不同"], ["fixed", "入力順"]])], parse: (v) => ({ type, places: boundedConditionText(v.names!).split(",").map((name) => ({ name: boundedConditionText(name), sources: [] })), order: v.order === "fixed" ? "fixed" : "flexible" }) };
    case "dates": {
      const d = r?.type === "dates" ? r : undefined;
      return { fields: [text("start", "出発日（最早）", d?.start.earliest, "date"), text("startLatest", "出発日（最遅・省略可）", d?.start.latest, "date"), text("end", "帰着日（最早・省略可）", d?.end?.earliest, "date"), text("endLatest", "帰着日（最遅・省略可）", d?.end?.latest, "date")], parse: (v) => {
        const start = { earliest: v.start!, latest: v.startLatest || v.start! };
        if (v.endLatest && !v.end) throw new Error("帰着日の最早日を入力してください");
        if (v.end && v.end < start.earliest) throw new Error("帰着日は出発日以降にしてください");
        return { type, start, ...(v.end ? { end: { earliest: v.end, latest: v.endLatest || v.end } } : {}), ...(d?.timeZone ? { timeZone: d.timeZone } : {}) };
      } };
    }
    case "duration": { const d = r?.type === "duration" ? r : undefined; return { fields: [text("minimum", "最小", d ? String(d.minimum) : "", "number"), text("maximum", "最大", d ? String(d.maximum) : "", "number"), select("unit", "単位", d?.unit ?? "nights", [["nights", "泊"], ["days", "日"]])], parse: (v) => ({ type, unit: v.unit === "days" ? "days" : "nights", minimum: integer(v.minimum!), maximum: integer(v.maximum!) }) }; }
    case "pace": return { fields: [select("pace", "ペース", r?.type === "pace" ? String(r.value) : "0.5", [...(r?.type === "pace" && ![.2,.5,.8].includes(r.value) ? [[String(r.value), "現在のペース"] as const] : []), ["0.2", "ゆっくり"], ["0.5", "バランス"], ["0.8", "いろいろ巡る"]])], parse: (v) => ({ type, value: Number(v.pace) }) };
    case "budget": { const b = r?.type === "budget" ? r : undefined; return { fields: [text("amount", "上限金額", b ? (b.limit.amountMinor / 10 ** currencyMinorUnits[b.limit.currency]).toFixed(currencyMinorUnits[b.limit.currency]) : ""), select("currency", "通貨", b?.limit.currency ?? "JPY", Object.keys(currencyMinorUnits).map((c) => [c,c])), select("basis", "対象", b?.basis ?? "trip", [["trip", "旅行全体"], ["per-person", "1人あたり"]])], parse: (v) => {
      if (!isCurrencyCode(v.currency)) throw new Error("通貨を選択してください");
      const digits = currencyMinorUnits[v.currency], parts = v.amount!.split(".");
      if (!/^\d+(\.\d+)?$/.test(v.amount!) || (parts[1]?.length ?? 0) > digits) throw new Error("通貨の小数桁に合う金額を入力してください");
      return { type, limit: { currency: v.currency, amountMinor: Number(parts[0] + (parts[1] ?? "").padEnd(digits, "0")) }, basis: v.basis === "per-person" ? "per-person" : "trip" };
    } }; }
    case "mobility": { const m = r?.type === "mobility" ? r : undefined; return { fields: [text("minutes", "移動時間の上限（分・省略可）", m?.maxTravelMinutes === undefined ? "" : String(m.maxTravelMinutes), "number"), text("transfers", "乗換回数の上限（0〜3・省略可）", m?.maxTransfers === undefined ? "" : String(m.maxTransfers), "number"), select("car", "車の利用", m?.carAvailable === undefined ? "" : String(m.carAvailable), [["", "未設定"], ["true", "利用できる"], ["false", "利用しない"]])], parse: (v) => {
      const { maxTravelMinutes: _a, maxTransfers: _b, carAvailable: _c, ...rest } = m ?? { type };
      return { ...rest, type, ...(v.minutes ? { maxTravelMinutes: integer(v.minutes) } : {}), ...(v.transfers ? { maxTransfers: transferCount(v.transfers) } : {}), ...(v.car ? { carAvailable: v.car === "true" } : {}) };
    } }; }
    case "experience": { const e = r?.type === "experience" ? r : undefined; return { fields: [text("text", "希望すること・避けたいこと", e?.text), select("intent", "希望の種類", e?.intent ?? "prefer", [["prefer", "できれば"], ["must", "必ず"], ["avoid", "避けたい"]])], parse: (v) => ({ type, text: boundedConditionText(v.text!), intent: v.intent === "must" ? "must" : v.intent === "avoid" ? "avoid" : "prefer" }) }; }
  }
}
