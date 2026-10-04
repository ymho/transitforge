# 未使用実装の整理（#799）

調査基準: main a061030（経路全体の選び直し #806 を含む）。
Frontend main、開発preview、Backendの10 Lambda、tools/MCP入口からの静的・動的importとre-export、workspace公開exportを照合し、候補の識別子・ファイル名を全体検索した。Backendの `.js` importはTypeScript元ファイルへ対応させて確認した。

## 撤去

- Issueの最初の15ファイルと隣接専用テスト11ファイル。現行のPlaybackController / digital-twin clock、端末標準日時入力、Server履歴・会話切替、Bedrock Adapter、Strands診断は維持する。
- 旧Semantic multi-turn fixture 3ファイル。
- 未接続の旧rail router re-export、research-continuation、rail専用TripImpactEvaluator（現在のTripImpactEvaluatorはrailとareaを扱う）、decimal string料金Adapterと専用テスト。
- 旧journey-navigation-intentと専用テスト、使われていないConversationQualityLive / EvaluationStability / RecommendationOutcomeの旧集計と専用テスト。現行の保存済みAgent Eval、Strands Live Eval、tools入口は維持する。
- Presentationのschedule-label re-exportを撤去し、そのテストを実装のあるusecases側へ移動。DST、跨日、時間精度のテストは保持する。
- Browserのexternal-travel-tools re-exportを撤去し、既存のEvidence・地点結合・警報のテストは現行の共有実装を直接importする。
- 使用中ファイル内の未使用primitive 7関数、行先アーチ設定、constraintSourceLabel、withInTripLocation、japanCalendarDate、旧ConversationSessionの生成/parse、MCPのtool名predicate、Browser宿泊/地点詳細wrapperと付随型・定数。
- createInternalRailImpactの未使用alias。sha256Hex / createStrandsReadTools / renderSemanticReceiptは同一ファイル内で使用するため、実装を維持しexportだけを外す。
- 未参照public画像2ファイル（245,060 bytes）。残る画像の来歴は維持する。
- 旧日時ピッカー・stepper・再生速度メニューのCSS selector 66件。混合selectorは使用中の枝を保持する。現行時計・Mapbox・日時入力のstyleは維持する。

## 維持・保留の理由

- Backend personal-api-composition / in-trip-context-composition-root、trip-composition-rootのinternal factoryは、認証付き内部hostや予定機能の明示的契約とテストがある。public Lambdaの現行組成とは分けて維持し、削除時にはその契約を別途整理する。
- Frontend trip-party-inputはpartyの入力検証契約、plan-assumption-viewは仮定と人数編集の共通テストに使われる。対象機能の正本を移すまで保持する。
- candidate-assessment-tool / assess-trip-candidate / trip-progress-tools、propose-trip-activity / propose-trip-transport / itinerary-proposal / update-trip-stateは採用・retention・条件・ownerに関わるfixture/テストの既存入口。現在未接続だが、単にテストを減らすために必要なinvariantを捨てない。今後撤去するなら現行Server操作へテストを移す。
- tool-result-evidenceはgrounding検証のテストで使用する。Serverの共有Evidence契約へ検証を移す作業は別に行う。
- modules/agentのcandidate-assessment-context / in-trip-application-evidence / semantic-interpretationと、modules/tripのplan-robustness / replan-dependenciesはworkspace公開契約と専用テストを持つ。未接続を理由に公開契約を削除しない。
- unified-consultation-previewは検証toolの生成HTMLから読み込まれる。静的importのみの検査では未使用と誤認するので維持する。
- dependency全体やCSSファイル全体の削除は行わない。Mapboxの動的class・独立したMCP/運用tools/Streaming PoCを維持する。

この整理は現在の起動経路とリポジトリ内参照に基づく。外部利用まで含めて未使用コードがゼロになったことを意味しない。#805はこの整理後のmainからデザインと導線だけを変更する。
