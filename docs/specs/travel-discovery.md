# 目的別旅行Tool

## モデルが選ぶ3能力

旅行相談の入口を固定文言・正規表現・Application分類器へ戻さない。Strandsへ次の能力を同時に公開し、会話とTripの現在条件を見たモデルが選ぶ。

| Tool | 用途 | 副作用 |
| --- | --- | --- |
| `explore_destination` | 特定場所の魅力、楽しみ方、写真、周辺候補 | read |
| `discover_destinations` | 体験価値から比較可能な複数候補を発見 | read |
| `draft_itinerary` | 既知条件から1件以上の仮旅程を保持 | proposal。Tripへは未採用 |

`explore_destination`と`discover_destinations`は既存のWeb/Knowledge Base discovery、上位ページの安全な読込、地点・写真のsource bindingをApplication内部で合成する。検索snippetや未解決地点を表示候補へ昇格しない。低水準Toolは既存Runtimeとの移行互換として残るが、Agent v2 promptは同じ目的での反復を禁止する。

`draft_itinerary`は既存のowner-scoped candidate retentionへ接続する。ServerがCandidateSet ID、Trip revision binding、期限を発行し、モデルはそれらを作らない。仮旅程の保持はTrip採用ではなく、採用・変更は後続の明示操作で行う。時刻、料金、営業、宿泊等の未確認値は`unknowns`へ残す。

## 取得結果の区別

目的別readは`outcome.status`を返す。

- `complete`: 必要な数の読了資料を確認し、地点・写真照合にも失敗していない。
- `partial`: 一部の候補や資料は使えるが、読込、地点/写真照合、複数候補数等に不足がある。成功結果を捨てない。
- `no_candidates`: 検索自体は完了したが候補が0件だった。
- `failed`: 検索を完了できず、候補が0件だった。候補が存在しない証明には使わない。

`completedScopes`、`failedScopes`、`reasonCodes`をモデルへ返し、0件と障害を自然文だけで推測させない。Provider例外も`failed`として返し、Tool errorだけへ潰さない。明示的な入力不正だけは`invalid_input`で拒否する。

## 写真の公開境界

`PublicPlacePresentation`の写真は任意である。Applicationがcurrentな`place_description` Evidenceから、HTTPS画像URL、写真ページ、attribution、任意licenseを投影する。モデルがカードpayloadや写真URLを提出する経路はない。写真がなくても候補カードは表示でき、placeholderや別ProviderへのBrowser fallbackは作らない。

Frontendは保存済みsnapshotをlive SSEと履歴で同じように描画し、写真をlazy loadして出典へリンクする。危険なURL、資格情報付きURL、秘密を示すquery parameter、余分なfieldはtransport/storage parserで拒否する。

## 検証境界

決定論的テストでは、3 Toolの公開、typed facet、complete/partial/no_candidates/failed、内部ページ読込と写真照合、V2 proposalの明示opt-in、CandidateSet保持、写真のApplication投影、SSE/history共通parserを確認する。実Bedrockによる3発話の意味選択と実Provider/画面E2Eは#758で扱う。

## 仮旅程の表示投影

`draft_itinerary`のモデル入力は`variants`（案名・日数・各日の予定）と共通の`unknowns`だけとする。
モデルがPublicPlanPresentation、表示日順、entry/item参照、表示タイトルを重複生成する経路を除く。
Applicationが検証済みの本体からDomainの日別投影を使い、既存カード用のread modelを決定論的に生成する。
タイトル・項目順・宿泊の複数日参照は本体と同じであり、日程未定は独立した未定欄へ置く。
空の日を確認済み自由日とは扱わず、未確認の料金・移動負荷・外部根拠を生成しない。

CandidateSetと表示の全検証を保持前に行い、保持に失敗した場合はカードを公開しない。
owner/conversation/Trip revision/期限と利用者確認後の採用は既存契約を維持する。
公開時のresearchOutcomeはServerの計測値を使い、モデルの自己申告や仮の0を公開しない。

本番の2026-10-03 07:37:16 UTCの失敗は、Tool 2回失敗・model 2回・構造化回答0回、
4581累積出力tokenで4096上限に達した。過去ログにはTool拒否の詳細がなく、具体的な不正項目は確定できない。
閉じたToolエラーコードを記録し、診断のTool一覧はiteration上限以外のtoken/deadline等も対象とする。
会話・Tool入力・例外本文はログへ加えない。上限自体は引き上げない。

実Bedrockでの修正途中の検証（[run 37116711186](https://github.com/ymho/transitforge/actions/runs/37116711186)）では、
内部ID・itemOrder・差分一覧の欠落と、利用できない根拠参照を検出した。
これらの管理情報もServer生成へ移し、モデル入力を案名・日数・予定・未確認事項に絞った。
既存項目の置換・削除には現在のTripに実在するIDを要求し、保持項目一覧はServerが算出する。

回帰検証では、3発話を実モデルで続けるケースと、報告された確認質問を固定して最後の
「はい、作成お願いします。」だけを実モデルへ渡すケースを分ける。
後者により、モデルが途中で出発地を質問した場合の「はい」の意味の変化と、旅程作成の失敗を混同しない。
Providerと状態は合成データであり、本番の旅行情報や検索Providerの可用性を検証したとは扱わない。

確定的な旅行期間は有効な会話条件からServerが日数へ変換する（1泊は2日）。モデルが短いdayCountを返しても日を失わず、予定のない日は未取得として残す。範囲・仮定・曖昧な期間から固定日数を捏造しない。同一ターン内の条件反映後も最新条件を参照する。

## 旅行候補のサービス対応範囲

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

## 旅行知識Discovery / Applicability

## 本番経路

`search_travel_knowledge`はServer Agentのread Toolである。typed facetsを`discoverTravelCandidates`へ渡し、Webと有効化済みKnowledge Baseを同じ`DiscoveryHit`へ正規化する。rank fusion後、設定時だけBedrock Rerankを実行する。HitはObservation/Evidenceへ変換して既存のGrounding経路へ渡し、Browserを検索の正本にしない。

| 構成 | 取得 | 再順位付け | 実行可能性 |
| --- | --- | --- | --- |
| Web-only | Brave Web | 元順位/RRF | Applicabilityで別評価 |
| Web + Rerank | Brave Web | Bedrock Rerank | Applicabilityで別評価 |
| Knowledge + Web | Retrieve + Brave Web | RRF、任意Rerank | Applicabilityで別評価 |

Rerank scoreは文書関連度であり、営業中、空席、費用、移動成立、推薦確率ではない。`TravelApplicabilityFact`は`opening_windows`、`access_requirement`、`visit_requirement`、`seasonal_relevance`だけを初期variantとし、日付未定・地点未解決・対象外scope・参加者不明を`unknown`にする。例外休業は通常窓より優先する。

## Provider capability

| Provider | typed fact | coverage / limitation |
| --- | --- | --- |
| Mapbox Ground Access | access lower bound | 検証済みstation/place identityと徒歩・車・自転車のみ |
| Mapbox Place | visit requirement unknown | Place identityと資料。自由文営業時間を構造化営業保証へ昇格しない |
| Web page | model-extracted候補 | exact source span検証まで。human/provider structuredと区別 |
| Bedrock KB Retrieve | DiscoveryHit | metadata欠損時subject未同定。HYBRIDは対応storeのfilterable text構成だけ。S3 VectorsはSEMANTIC |

検索snippetや本文先頭1,200文字をcompleteとは扱わない。保持禁止の本文はEvidence、Trace、cacheへ残さずreferenceだけを保持する。共有Knowledge BaseへProfile、会話、予約、支払、個人情報を投入しない。

## 有効化とLive測定

1. `travel-knowledge-manifest.schema.json`へ適合し、親文書から例外日まで追跡可能なmanifestを作る。
2. 対象regionのKnowledge Base、vector store、reranker model対応をAWS公式仕様で再確認する。
3. Terraform変数へ既存KB ID、vector store capability、requested search type、任意reranker ARNを設定する。
4. `terraform plan`で`bedrock:Retrieve`が対象KB ARNだけ、`bedrock:Rerank`がgate時だけ付与されることを確認する。
5. 同じtyped input、source集合、budgetでWeb-only / Web+Rerank / Knowledge+Webを実行し、候補recall/diversity、順位、invalid index、latency、取得件数、推定費用を記録する。
6. ingestion/update/delete後はmanifest revision、index、Application cacheを同時に更新し、削除sourceを再提示しないことを確認する。

このリポジトリの設定はdefault-offであり、adapter存在だけを本番接続済みとは記録しない。

AWS公式参照（2026-09-23確認）:

- [Knowledge Base query configuration / HYBRID capability](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-test-config.html)
- [Retrieve metadata filtering](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_agent-runtime_KnowledgeBaseVectorSearchConfiguration.html)
- [Rerank permissions](https://docs.aws.amazon.com/bedrock/latest/userguide/rerank-prereq.html)
- [Rerank API](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_agent-runtime_Rerank.html)
