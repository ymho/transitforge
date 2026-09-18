# Place identity / 地域適合（#377 / #366、Draft）

## 再利用する契約

永続的なPlaceRef / PlaceSnapshotは変更しない。検索中のPlaceMediaにresolved / unresolved / mismatchの任意observationを追加する。名前・近接座標だけで同一性を証明しない。same-provider stable IDを用いるpure helperとdedupを追加し、親施設と子施設の別IDを保持する。

Webの候補と検索結果の接続では名前一致を廃し、取得した公式ページURLのexact bindingに限定する。bindingがない候補はbounded observationとして返し、verified map candidateへ昇格しない。検索語は書き換えず、既存のTool重複抑止を維持する。

既存TravelCandidateAssessmentへidentity観測の入力seamを追加し、unresolvedをunknown、mismatchをquestionableにする。resolvedだけで地域fitと断定せず、既存の地域・目的地制約評価を維持する。#452のcoverage契約は実装しない。

## 未完了・マージ不可

- direct search / enrichment / restaurant経路を含めたidentity bindingのproduction配線監査が残る。任意identityの未設定を一律拒否すると既存検索を壊すため、現段階では未設定のlegacy結果を許容している。この経路を完了扱いにしない。
- Assessmentの新しい入力seamを地域intentに結び付けるproduction配線が残る。Domainのテストだけでは#366完了ではない。
- 同一コードによる地域不一致Live 5反復は0/5。失敗は正規化制約不足。誤地域推薦が0であるとの完了証明は得られていない。
- Provider namespaceのないlegacy IDの扱い、公式URLを持たないが正当な候補の未解決後の再探索体験を継続検証する。

このPRは安全側への部分実装であり、両IssueのAC完了までDraftを維持する。Trip V2保存や#414の契約は変更しない。
