# 会話履歴と出力予算の監査（2026-09-08）

## 調査範囲と根拠

非公開S3の9月のFeedback 31件と9月7日のmodel-call trace 79件をローカルで調査した。
これらは独立した31セッションや79回の旅行相談を意味しない。同一会話内の複数呼び出しを含む。
生会話、個人情報、request ID、providerRequest、AWSアカウント情報はこの文書へ転記しない。

- 79呼び出し中2件が`max_tokens`で終了した。生成上限は500 tokensだった
- 12件で`conversation.relevantMessages`に入れた履歴JSONが500文字で切れ、JSONとして成立していなかった
- 26件でContextの圧縮が発生した。旧core形式はconversation自体を含めなかった
- 調査対象にはProfileフィールドが存在した。単に「プロフィールを送っていない」とは説明できない
- Tool結果には既出質問の拒否、検索入力不足、必要なWeb本文未取得などもあった。これらは履歴欠損だけで説明できるとは限らない

本番モデルは会話用`amazon.nova-lite-v1:0`と構造化判断用`jp.amazon.nova-2-lite-v1:0`だった。
モデル比較の前に、既知の履歴を欠落させる入力処理と、短い出力枠を修正する。

## 変更と責務

履歴を最大12件・各1,600文字のrole/text配列へ変更した。旧JSON文字列形式も切断前に復元する。
Context JSONの上限は3,600から24,000文字へ拡張し、圧縮時も直近の会話を残す。
APIのtext上限を4,000から32,000文字へ合わせ、HTTP bodyの2 MiB上限は維持する。
履歴全量を無制限に送るものではなく、古い文脈は既存のsummary、TripContext等も使う。

Bedrockの生成上限を500から4,096 tokensへ変更する。Decision Summaryと回答の両方に余裕を確保するが、
常に4,096 tokensを生成する指定ではない。比較用Adapterオプションは1〜5,000を検証する。
[Novaのリクエスト仕様](https://docs.aws.amazon.com/nova/latest/userguide/complete-request-schema.html)と
[Nova 2の仕様](https://docs.aws.amazon.com/nova/latest/nova2-userguide/request-response-schema.html)の範囲内で設定する。

Issue #306とADR 0044/0048の責務分担は維持する。新しい発話routerや固定Plannerは追加しない。
意味解釈とTool選択は引き続きBedrock、Evidence生成・検証、Viewer policy、実行回数とtimeoutはコードが担う。
既出質問の安全弁は構造化履歴と旧履歴の両方で検証する。モデルやSystem Promptは変更しない。

## 評価

Live Evalは架空の入力と固定Tool結果を使い、Bedrockの意思決定を実測する。
2回のTool実行後に最終回答できるよう、Eval専用budgetを2から3 model callsへ修正した。
従来の2回では2つ目のToolを期待するケースでも最終回答を要求してしまっていた。本番budgetは変更しない。
長い比較会話の後に「2番目」を参照するケースを追加した。同じ修正済み15件で比較した。

| 実験 | 結果 | 反復 |
| --- | --- | --- |
| structured-decision routing・500 tokens | 14/15 | 1回 |
| 同routing・4,096 tokens | 15/15 | 1回 |
| 長い会話後の候補参照・4,096 tokens | 3/3 | 同一ケース3回 |

15件単回比較では両設定ともmodel calls 18、tool calls 16だった。Trace集計は500 tokens設定で
入力63,446 / 出力1,971 tokens、モデルlatency合計14,093 ms、4,096設定で
入力63,443 / 出力1,715 tokens、同12,955 msだった。これは単回測定であり、latency短縮や費用削減の保証ではない。

単回の15/15は安定性や改善の因果関係を証明しない。このLive EvalではGrounded Claim Rateと
Unsupported Claim RateがN/Aであり、文章の自然さ・実APIを含む完遂率も保証しない。
決定論的Smoke Evalと既存テストは別途維持し、自然さは展開後の複数ターン会話で確認する。
実会話providerRequestのBedrock再送は自動承認審査で拒否されたため実施していない。
結果と生データはGit管理外のローカル作業領域に保存した。

## 残る確認

- 同一の複数ターン会話で、既知条件の聞き直し、代名詞・候補番号・帰路の参照、旅程変更の継続性を確認する
- 実APIの欠損や入力エラーを受けた再計画と、利用者への説明を評価する
- model/tool call数、入出力tokens、latency、timeout率を展開前後で測る。入力枠・出力枠の拡大は費用やlatencyを増やし得る
- 入力欠損を直した条件でモデル比較する。今回の結果だけでモデルの能力不足を否定しない

## 2026-09-21 実Feedbackの回帰シナリオ

出雲大社の相談で、所在地を松江市と誤答し、「明日から」を受け取った後も日程を聞き直し、
不明条件を仮定してよいという明示依頼にも旅程・総額を提示しない会話を確認した。
生のassistant回答はfixtureへ保存せず、利用者turnと意味的な期待値だけを
`conversationQualityScenarios/feedback-izumo-provisional-plan`へ匿名化して保存する。

このケースでは固定時計から「明日」を解決し、出雲大社を出雲市として扱い、出発地・人数・泊数は
明示した未確認の仮定に留める。日付を聞き直さず、遅くとも最終turnで仮旅程と旅行全体・全員分の
費用概算へ進むことを合格条件とする。Profileは今回条件の事実へ昇格させない。

Issue #474のモデル比較では同じ複数turnシナリオをbaseline/candidateで複数回実行する。
比較器は全既存品質指標を維持したうえで、品質またはlatency/tokenのいずれかが改善すれば採用候補にできる。
これにより、上位モデルの品質向上を「コスト削減がない」という理由だけで棄却しない。モデルIDの切替は
このfixture追加だけでは行わず、実Bedrock比較のmodel ID・反復数・latency・token・費用を記録して決める。
合成Provider結果も本番Toolと同じEnvelopeへ入れ、本番の`externalTravelEvidence`でEvidenceへ変換する。
Evidenceを生成しない簡略fixtureは、モデルが選んだ実在しないEvidence IDとして正常回答まで拒否するため使わない。
写真数も本番の`image.url` / `images[].url`を数え、旧fixture専用keyへ依存しない。相対指標が改善しても
候補が全評価ケースを完遂しない限り、本番routingへの切替は推薦しない。

追加の実Feedbackでは「出雲大社に明日から1泊」と目的地・相対日付・泊数が揃っているのに、明日の日付、
Profile由来の出発駅、予算、自然アクティビティを質問票のように一括確認していた。このケースを
`feedback-izumo-one-night-no-questionnaire`として追加した。通常の相談turnはBrowserのローカル暦日を
`uiContext.calendarDate`で送り、Serverが暦日として検証したうえで`featureContext.relativeDates`へ
今日・明日・明後日を展開する。同じturn IDの再送では最初の暦日を含む同一requestを維持する。

暦日は相対日付解決の表示Contextであり、ProfileやTripの正本ではない。Browserから会話履歴・Profile・Trip本文を
送る経路は追加しない。モデルは計算済みの明日を日付で聞き返さず、Profileの出発地・同行者・嗜好を今回条件へ
昇格させない。目的地・日程・泊数が揃った相談では質問だけで終わらず、未確認事項を仮定として分離して具体案を示す。

期待する初回価値は、目的地の短い紹介、日ごとの簡単な行程、宿泊候補または宿選びの方向性、代表写真である。
`feedback-izumo-one-night-no-questionnaire`はこれらを最初のassistant turnで満たし、表示可能な地点写真を1枚以上返す。
複数turn版も目的地と相対日付が揃う2 turn目までにstarter planへ進み、費用概算の依頼を待って初めて旅程を出す
挙動へ戻さない。写真は既存の地点検索結果と出典付き写真カードを使い、モデルがURLを生成しない。

目的地未定の「歴史を感じながらゆっくりできる場所」も質問だけで地域を絞らせない。既存Benchmarkの
`vague-destination`はWeb調査、本文確認、POI照合を経て、具体的な候補2〜3件、候補ごとの簡単な行程、写真を一度に返す期待へ変更した。
出発地や予算が必要な精密経路・総額は未確認として分離できるが、それを最初の提案を止める条件にはしない。

追加Feedbackの「明日出発で、ゆっくりできる旅行」は`feedback-open-ended-relaxed-tomorrow`へ保存する。
2026-09-22出発として解決し、1泊・人数・起点・予算は必要なら未確認の仮定に留め、最初のassistant turnで
2〜3候補、比較理由、候補ごとのstarter plan、候補に対応する写真を返す。写真の下限は2枚とし、1枚目だけを
会話へ表示して残りを地図panelへ隠す挙動を認めない。

製品の推薦範囲はv6 UIで合意した「収録済み駅・時刻表エリアのある西日本を中心」とする。これは県名の
固定allowlistではない。ADR 0066どおり、実際の移動のsupported判定は読込済み日付別経路、駅カタログ、
施設なら確認済みGroundAccessから導く。目的地未定の発見では熱海・伊東等を主候補にせず、範囲外の場所を
利用者が明示した場合は相談を拒まず、移動の範囲外または未確認を分離して説明する。

## 2026-09-24 Run #25 の出力契約安定化

PR #580展開後の3反復では8/9 scenario-attempt、16/18 turnを完遂した。残る2 turnはProviderやToolの
失敗ではなく、`feedback-izumo-provisional-plan`の3反復目で`invalid_response_contract`となった。
Traceでは宿泊・天気Evidence取得後に長いapplication-strict応答を返しており、base contractを選んだturnでも
モデルが任意の`travel-plan`を返し得る。一方、Decision metadataだけが不正な場合の独立presentation検証を
presentation必須contractに限定していたため、安全にApplication検証へ渡せるpayloadまで破棄していた。

recognizedなtop-level presentationは、選択されたcontractで任意の場合もDecisionとは独立に保持する。
これはTool routingやDecisionのvalid化を行うfallbackではない。Evidence、抜粋、行程、費用、写真は従来どおり
Application parserが全件検証し、不正なら表示しない。また、旅程内容の検証修正とwire contract修正は別の
bounded budgetを各1回だけ持つ。共通のmodel call、iteration、timeout上限は維持し、同じ種類の不正を無制限に
再試行しない。Profile等を省略するTraceでは、任意の理由文は引き続き伏せ、Applicationが定義した診断codeだけを
保持する。これによりraw応答を保存せず、次回比較で失敗境界を判別できる。

## 2026-09-24 Run #26 のEvidence継続性

Run #26は3反復で6/9 scenario-attempt、10/18 turnを完遂した。失敗は`unbound_candidate_source` 5件と
`invalid_response_contract` 3件で、特に`feedback-izumo-provisional-plan`が全反復で不安定だった。
最初のturnで検証した旅行先のsource Evidenceは同一Runtime内だけに存在し、後続turnが宿泊・天気Evidenceを
取得した時点では再利用できなかった。一方、会話履歴には表示文、Working Stateには候補参照だけがあり、
引用とsource URLを再検証できるEvidenceそのものがなかった。

公開presentation/Claimが参照した`bounded_excerpt` Evidenceだけをturn完了と同じtransactionでWorking Stateへ保存し、
次turnの`initialEvidence`へ再注入する。最大24件・64KBとし、raw Tool output、未公開・保存禁止Evidence、Profile、
会話本文は追加保存しない。モデル向けWorking State投影からEvidence payloadを除き、Grounding instructionとしてのみ渡す。
`unbound_candidate_source`修復時は利用可能source IDを明示し、sourceが0件なら同じtravel-planを再生成させず、
native Toolによる再取得か根拠不足の説明へ戻す。

モデル比較runには全turn数、完遂turn数、完遂率、failure code分布、cache read/write tokenとstatus分布を追加する。
集計qualityが改善していても全turn完遂・failure code 0でなければproduction routingを推薦しない。

## 2026-09-24 新規相談の質問票ループ防止

目的地未定の旅行相談で、モデルが任意の好みを`user_confirmation_required`として返すと、System Promptでは
具体案を先に求めていてもRuntimeが質問だけの応答を許可していた。新規のdiscovery/draft/refineでは、
安全確認または明示的なauthorizationだけを初回の質問単独終了として認める。候補選択の`user_decision`は、
前turnに候補・比較等のvisible progressが保存されている場合だけ質問単独終了を認める。

Runtimeはmodel回答とterminal回答に既定の`AgentTurnObservation`を付与し、`ask_only`、`answer`、
構造化候補の`progress`をWorking Stateへ保存可能にする。これにより同じ会話の次turnでも、質問だけを
連続させないApplication policyが実際の本番compositionで働く。モデルのreason codeだけを進展とは扱わない。
