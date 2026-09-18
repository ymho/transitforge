# Place entity identityと検索対象binding（#377 / #366）

## 境界

永続的なPlaceRef / PlaceSnapshotは変更しない。Provider IDはそのentity自身のidentityであり、
「利用者が探す地区/施設そのもの」「希望地域に適合する」ことの証明ではない。
検索中のPlaceMedia.targetBindingはrequested targetへの照合結果だけを表す。
名前の部分一致、座標の近さ、検索順位からresolvedへ昇格しない。

- discovery: 周辺店舗などを候補自身として表示可能。targetBindingなしは「地域適合確認済み」ではない。
- target: 既に取得したtargetPlaceIdとprovider namespace、または取得済み本文とProviderの公式施設ページのexact bindingを要求する。
- source binding: 同一HTTPS origin/pathの施設ページのみ。host/root、query/fragment付きURLは証明にせず、複数entityが同じページへ一致する場合も未解決。
- unresolved/mismatch: 観測をTool結果に残すが、targetの地図候補へ入れない。discovery指定で既知の失敗bindingを消すこともできない。
- same-provider exact IDだけdedupする。親子別ID、異なるproviderは統合しない。

## Production inventory / After

| 経路 | 境界 |
| --- | --- |
| search_place_media | discovery / targetを明示。既知ID・読了URLはApplication stateから解決。候補ごとの既存Assessment relevanceと失敗bindingをTool observationへ返す |
| resolve_place_candidates | ページ本文の施設名は検索hintのみ。候補と結果の結合は一意な公式施設ページbinding。名前一致を同一性の根拠にしない |
| enrichment | 同一provider/entity、または一意な公式source bindingだけ写真/説明を補完。名前・近接座標で他entityの写真を添付しない |
| restaurant | Hot Pepper自身の候補・座標はそのまま表示。既知mapboxPlaceIdがある場合だけMapbox結果と結合。名前しかない飲食店へ追加POI検索しない |
| Activity / Trip adoption | 既存ActivitySelectionPortの単一ID解決、scope、期限、source、保存権限、allowlist snapshotを維持。target bindingが未解決/不一致ならProposalへ採用しない。discovery entityの明示選択は可能 |
| map layer / map candidate | 失敗bindingは描画候補にしない。表示name/位置はentity自身の値。detailは同じprovider ID以外をmergeしない |
| detail refetch | UIの取得済みrefをHTTPで渡し、Backendが再検索結果と照合。先頭の近隣店舗を代用しない。Mapbox landmarkはmapbox_idのみをopaque IDとして使い、feature描画IDを代用しない |
| Wikipedia fallback | Provider namespaceをidentity sourceとして明示。Mapboxと同名でもmergeしない |
| Agent / Assessment | 下記の既存relevanceをTool結果へ流し、モデルが次の確認・比較・説明を判断。検索語の自動書換えや固定再検索フローは追加しない |

## Assessment seam

targetBinding → 既存TravelCandidateAssessment.relevance → candidateAssessments / targetObservations
→ production executeViewerToolAdapter → bounded Tool observation → モデルの候補比較、という経路を使う。
resolveの直後に先頭候補をアプリが自動推薦し、会話をterminalにする旧処理は削除した。
照合結果を受けたモデルの1回の意思決定を経て、推薦・追加確認を選ぶ。照合のある旧フローではこの分のcallが増えるが、
通常answer/native ToolやA〜AUの契約・閾値は変更しない。

Tripがある場合は既存assessCandidateConstraintsへTrip.requestを渡す。同じ名前や地域らしい文字列からfitへせず、
同じPlaceRefの目的地条件だけを確認する。一施設は目的地全体のcomplete coverageとは扱わない。
未構造化の地域希望を自然言語regexで正本化しない。検索所在地・未解決relevanceを見たBedrockが再検索/別確認/説明/質問を選ぶ。
保存済みcandidateのfull AssessmentでもplaceTargetBindingが未解決ならunknown、不一致ならquestionableへ反映する。
参照可能Evidenceがない場合はunknownを維持する。#452のcoverage contractや新Plannerは追加しない。

## #366の結果ベース評価

`npm run eval:agent:decision:live -- --profile full --case nearby-search-geographic-mismatch --repetitions 5 --output-dir /tmp/geo-live`

実Bedrockとproduction Viewer Runtime / external Tool / Assessment経路を使用する。
外部Providerだけは版管理されたsynthetic fixtureで、最初のWeb検索に京都の希望とは異なる宮崎県の候補を混ぜる。
旧「search_web→read_web_pages→search_web」「queryに地域名必須」採点は削除した。

hard gateは最終利用者向け本文と表示候補に対するfixture固有のforbidden recommendation、および未解決bindingの昇格禁止。
単なるTool名の成功では合格にしない。Runtime failureも成功扱いにしない。
明示的な除外・未確認説明・追加質問は許容し、正常な候補へ到達したhelpfulnessを別指標で報告する。
Evalの日本語表現判定は保守的なfixture専用graderで、production routerには使わない。
自然文の意味を完全に証明する汎用entailment検証ではない。Aliasもfixtureで指定し、危険な肯定推薦をunit testで拒否する。
A〜AU、モデル、temperature、TTFI/TTFC閾値は変更しない。

## 保守的な制約 / 後続

公式施設ページやknown IDがない正当な候補も未解決になり得る。legacyのprovider namespace不明データから同一性は推測しない。
mapbox_idを持たないlandmarkは名前と既存の相談操作を維持するが、別施設を詳細として埋めない。
名前検索による写真補完の件数は減り得る。これを補うためのOCR/vision追加は本PRでは行わない。
一般自然文の全事実保証は#376、製品化と候補coverage改善は#449/#452の責務とする。
writer / CAS / auth / PlaceSnapshot保存制約 / realtime計算は変更しない。
