import type { AgentToolDescriptor } from "./tool-contract";
export const accommodationToolDescriptor: AgentToolDescriptor = {
 name: "search_accommodations",
 description: "指定日程と宿泊地の宿泊候補を調べます。Providerで未確認の空室や料金を推測しません",
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
        limit: { type: "integer", minimum: 1, maximum: 5 },
      },
      required: ["destination", "checkInDate", "checkOutDate"],
      additionalProperties: false,
    }
};
