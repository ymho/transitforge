import type { AgentToolDescriptor } from "./tool-contract";
export const requestAssumptionsDescriptor: AgentToolDescriptor = {
    name: "propose_request_assumptions",
    description: "不足条件を変更可能な既存PlanAssumptionとして提案する。persistedTripRequestを丸ごと引き継ぎ、新規constraintはsource=assumptionでmodel/unconfirmedの仮定と相互参照する。例: constraintsへ {id:'pace-provisional',source:'assumption',strength:'soft',scope:{type:'trip'},requirement:{type:'pace',value:0.3},assumptionId:'pace-assumption'}、assumptionsへ {id:'pace-assumption',text:'ゆっくり巡ると仮置き',source:'model',status:'unconfirmed',affects:[{type:'constraint',constraintId:'pace-provisional'}]} を追加する。paceは0〜1。他のrequirementは既存TripRequest契約に従う。既知条件の変更・仮定の確認/却下・user事実への昇格・新しいProvider事実は禁止。単なる仮定列挙だけでなく具体案と組み合わせる。",
    inputSchema: { type: "object", properties: { request: { type: "object", properties: {
      goal: { type: "string" }, constraints: { type: "array", maxItems: 40, items: { type: "object" } },
      assumptions: { type: "array", maxItems: 40, items: { type: "object" } },
      party: { type: "object", description: "今回のTripParty。未知の子の年齢は省略。新規仮置きはsource=assumption、assumptionIdでmodel/unconfirmed/affects:[{type:'party'}]を参照。既知partyは書き換えず引き継ぐ。人数はcompositionから推定しない。",
        properties: { adults: { type: "integer", minimum: 0 }, children: { type: "array", items: { type: "object", properties: {
          age: { type: "integer", minimum: 0 }, ageGroup: { type: "string", enum: ["baby", "preschool", "elementary", "teen"] },
        }, additionalProperties: false } }, composition: { type: "array", items: { type: "string", enum: ["solo", "partner", "friends", "children", "family"] } },
        source: { type: "string", enum: ["user", "profile", "legacy", "assumption"] }, assumptionId: { type: "string" } },
        required: ["adults", "children", "source"], additionalProperties: false },
    }, required: ["constraints", "assumptions"], additionalProperties: false } }, required: ["request"], additionalProperties: false },
  };
