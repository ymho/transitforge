import type { AgentToolDescriptor } from "./tool-contract";

export const requestChangesDescriptor: AgentToolDescriptor = {
  name: "propose_request_changes",
  description: "利用者が保存済みの旅行条件を変更・解除したいとき、現在値との比較・明示確認に出す未保存の案を作る。replace_constraint/remove_constraintはpersistedTripRequestの実在constraintIdを指定する。同じ種類のrequirement全体とhard/softを指定し、変更を頼まれていない属性は引き継ぐ。例: {type:'replace_constraint',constraintId:'dates',requirement:{type:'dates',start:{earliest:'2026-10-10',latest:'2026-10-12'}},strength:'hard',reason:'出発希望日を変更する案'}。曖昧な日付はrangeを保持。set_partyは明示人数とchildren（年齢不明は{}）を指定し、Profileの同行傾向から人数を推定しない。set_goal/clear_goalは目的の変更・解除。clear_partyは今回人数の解除。reasonは利用者に示す短い変更理由。source/status/assumptionId/Trip ID/revisionはApplicationが決め、入力不可。置換値はmodel/unconfirmedの仮置きであり、既存の仮定を確認済みにはしない。全変更をchangesにまとめる。新規条件の仮置きはpropose_request_assumptions。予定・予約・Profileは変更せず、保存済みと回答しない。",
  inputSchema: { type: "object", properties: {
    changes: { type: "array", minItems: 1, maxItems: 8, items: { type: "object", properties: {
      type: { type: "string", enum: ["replace_constraint", "remove_constraint", "set_party", "clear_party", "set_goal", "clear_goal"] },
      reason: { type: "string", minLength: 1, maxLength: 240 }, constraintId: { type: "string", minLength: 1, maxLength: 200 },
      requirement: { type: "object", description: "既存TripRequirementの同じtype。新しい場所は{name,sources:[]}の名称希望のみ。Provider ID/座標/Evidenceは捏造しない。" },
      strength: { type: "string", enum: ["hard", "soft"] }, goal: { type: "string", minLength: 1, maxLength: 240 },
      party: { type: "object", properties: { adults: { type: "integer", minimum: 0, maximum: 100 },
        children: { type: "array", maxItems: 100, items: { type: "object", properties: { age: { type: "integer", minimum: 0 },
          ageGroup: { type: "string", enum: ["baby", "preschool", "elementary", "teen"] } }, additionalProperties: false } },
        composition: { type: "array", items: { type: "string", enum: ["solo", "partner", "friends", "children", "family"] } },
      }, required: ["adults", "children"], additionalProperties: false },
    }, required: ["type", "reason"], additionalProperties: false } },
  }, required: ["changes"], additionalProperties: false },
};
