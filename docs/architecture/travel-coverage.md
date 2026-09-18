# 旅行候補のサービス対応範囲（#452）

## 共有する契約

`assessTravelCoverage(CandidateAssessmentFacts, now)`は取得済み情報だけを評価する。
Home、Agentのcandidate assessment、rail採用は同じDomain invariantを使用する。
新しいcoverage保存resource、地理的blacklist、Plannerはない。

Live比較の「既知条件」fixtureは、syntheticな駅identity解決結果と日付Evidenceを明示する。
名前だけのoriginや未証明のtimezone条件を、条件確認済みのケースへ混ぜない。
`coverage-live-input.fixture.test.ts`でhard条件の成立と、根拠を除いた場合のunknownを両方確認する。
これは評価入力の整合修正であり、本番の名前照合・identity推測やDomain validationを緩めるものではない。

| 状態 | 意味 |
| --- | --- |
| supported | 読込済みの日付別経路・カタログが一致し、施設なら駅からのアクセスも確認できる |
| outside-coverage | verified経路の区間駅が現在のカタログに収録されていない |
| unresolved | 未調査、同名曖昧、入力更新、代表ダイヤ、施設へのアクセス未確認等 |
| data-unavailable | 時刻表/カタログ欠落、不正入力、期限切れ等 |

一度も探索していない地点や経路が見つからないだけの地点を、全国非対応と断定しない。
カタログ内に駅があるだけではsupportedにならず、既存`verifyRailCandidateSchedule`を通す。
出典versionは最大16入力、最大32leg。理由とversionはbounded assessmentへ投影する。

## 施設と採用

PlaceSnapshotのprovider identityと座標、実際に経路が使用する収録駅、GroundAccess両端の結合を検証する。
名前だけ・近いだけ・manual placeにはアクセス確認済み表示を付けない。
地上アクセスが欠測/古い場合は未確認であり、到達可能へ補完しない。

rail候補のpreviewとconfirmは最新loaderからカタログ/入力を再取得し、supportedでなければ採用を拒否する。
Domainのsnapshot validator、provenance、scheduled/realtime分離はそのまま維持する。
宿・Activityのselectedは施設を選んだという意味で、交通確認や予約を含意しない。
Tripのadoptionも利用意思であり、coverageやFeasibilityの認定を兼ねない。
手入力の非鉄道移動Proposalは候補比較の代替ではない。Tool descriptorで、鉄道候補の比較だけの依頼や、未確認の鉄道を希望されていない車へ置き換える用途には不適と明示する。能力は非表示にせず、比較・変更の選択自体はモデルに残す。
既存の`assess_travel_candidate`はFrontend登録だけでなく、Agent APIのTool定義・native toolUse応答の両境界で許可する。許可リストの漏れでモデルが選んだ比較を失敗させない。任意名のToolや自動適用能力は引き続き許可しない。

## UI / Agent

短い状態表示を基本とし、詳細でreasonを表示する。未知候補を「調査済みのおすすめ」にしない。
Tool descriptorは取得不足を説明するが、検索順序や代案を固定しない。
`serviceCoverage`をApplicationが付加し、モデル作成のJSONだけでは証明にならない。
Home実データ接続は#453でこのassessmentを利用する。

## 後続と制約

公開auth/writerは#451/#454のgateの内側。未配線の候補sourceをUI用固定おすすめで代用しない。
全国/海外の入力収集や地理範囲の独断拡大は対象外。境界の最新実体は読込済みversion付き入力である。
