import type { AgentToolDescriptor } from "./tool-contract";
export const representativeTimetableToolDescriptor: AgentToolDescriptor = {
  name: "search_representative_timetable", description: "平日または土休日の代表ダイヤを検索します。特定日の運行を保証しません",
  inputSchema: { type: "object", properties: {
    timetableKind: { type: "string", enum: ["weekday", "weekend_holiday"] }, query: { type: "string", minLength: 1, maxLength: 200 },
    mode: { type: "string", enum: ["active", "arrivals", "departures"] }, targetTimeMinutes: { type: "number", minimum: 0, maximum: 2160 },
    limit: { type: "integer", minimum: 1, maximum: 5 },
  }, required: ["timetableKind", "query", "mode"], additionalProperties: false },
};
