# Agent v2の構造化出力と公開境界

関連: #716、#631、ADR 0096。対象SDK: @strands-agents/sdk 1.18.0。

```text
userMessage → Strands Agent
  → 必要ならupdate_intent / A commit
  → read Tool / Evidence
  → SDK structuredOutputSchemaで構文検証・終了
  → result.structuredOutput.reply
  → Application admission / Evidence・claim検証
  → B commit → SSE / history / replay
```

## 標準機能に委ねること

Zodのstrictなdiscriminated unionを構文の唯一の定義にする。SDKへ渡すJSON SchemaとApplicationのparseは同じZod schemaから生成する。SDK Toolの最上位はobjectで、variantはreplyの中へ置く。独自のflat schema、手書きvariant parser、submit_reply Tool、提出済み状態、Model Proxy、toolChoice切替は使わない。

SDKは有効なstructured outputを取得した時点で終了する。回答取得後に終了用のmodel callを追加しない。通常のlastMessage、toString、reasoning、SDKのplain textは公開も保存もしない。

## 検証の責務

Schemaの通過は事実の正しさや保存の権限を証明しない。Evidence参照の存在・一意性・currentness、Effective Intentのrevision/fingerprint、操作receipt、owner、CASはApplication側に残す。モデルがschemaに沿った架空IDを返しても公開しない。

#758の実Provider検証で確認した衝突を避けるため、Web discoveryのhit IDは問い合わせと情報源を含める。
検索内の順位（`web-1`等）を複数facetで共有するIDとして使わない。Discovery Evidenceは実行・Tool呼出し単位の
観測として識別し、再検索や次の相談で取得時刻が変わっても以前の観測と混同しない。複合Toolが返す
読了ページと地点照合は、同じProvider参照を含んでも別の投影として識別する。
同一観測の再投入は冪等とし、本当に同じEvidence IDへ異なる内容を割り当てた場合の公開拒否は維持する。

## 調査結果と回答の完了

`replyReferences`は公開時と同じEvidence/currentness・Intent・表示可能な値の検証を通した参照だけを返す。
各項目は`{ reference: { evidenceId, field }, value }`とし、モデルは`reference`をそのまま選択する。
概要・アクセスなどの見出しからfieldを作らせず、資料値と参照の組を明示する。
未検証の検索snippetを回答用根拠として提示しない。公開時の再検証は省略しない。
`explore_destination` / `discover_destinations`のモデル向け結果はoutcome（部分失敗の範囲を含む）と
回答・カード用参照へ絞る。内部のdiscovery batch、取得ページ、地点照合、assessmentは重複して渡さず、
元のTool結果とEvidenceはApplicationに保持する。他のToolの出力は変更しない。

日程未定でも利用者自身の行き先の希望を受理できる。未指定をclearとして扱わず、写真等が不足するpartialは
確認できた情報で回答し、不足を説明できる。固定Tool順・発話別分類・強制回答・独自の反復抑止は追加しない。

CDのdev環境は`jp.anthropic.claude-sonnet-4-6`を明示選択し、compositionはNative adaptive thinking/mediumを指定する。
Nova 2を明示選択した場合は従来の`reasoningConfig`/lowを使う。両Providerの設定は排他とする。
Engineの既定は推論設定を追加しない。小さい独立fixtureと本番設定を分け、日程liveは両構成で検証する。
他のModel IDへNova固有パラメータを送らない。モデルの回数・累積出力・実行時間の上限は変更しない。
推論tokenも出力課金と累積出力上限に含まれ、内部reasoningは公開・保存しない。
参考: [AWS Nova 2 extended thinking](https://docs.aws.amazon.com/nova/latest/nova2-userguide/extended-thinking.html)。

## 短い説明・話題別表示・相談の継続

`answer`は根拠となる`references`と、短い`commentary`または`sections`（見出しと本文、最大4節）を提出できる。
説明がある場合、参照したWeb本文をその後へ連結せず、Applicationが検証した出典リンクだけをまとめる。
説明のない直接引用でも`sourceExcerpt`は最大160文字とし、資料本文を大量表示しない。
説明と各節は選択したEvidenceへのbindingを持ち、生成された事実を検証済みの資料値とは扱わない。
見出しはモデルが内容から選ぶ。固定の分類器や必須の「概要・イベント・アクセス」テンプレートにはしない。
イベントの過去/将来と未確認を区別する方針もモデルへ渡すが、Schema成功を事実性の証明にはしない。

`answer`/`candidates`の`nextQuestion`で、情報提供と次の確認を同じターンに含められる。
モデルは既知条件・利用者の関心から質問を1つ選ぶ。固定の質問順や未設定項目の一括聴取は行わない。
見出し・本文・質問中のHTML/Markdownはエスケープし、見出しの構造だけをApplicationが付ける。

Frontendはcurrentな回答を表示した後、actualな条件の受理receiptがあればTripをServerから再取得する。
回答の表示前やSSE受信中にrevisionを更新して、自分の応答をstaleとして破棄しない。receiptの値をBrowserで
Tripへ転記しない。履歴再表示・別会話の遅延応答・拒否のみのreceiptでは再取得しない。再取得失敗時は既存の
unavailable表示とし、古い条件を最新情報として残さない。

## SDKの再試行を隠さない

SDK 1.18.0は不正な構造化出力にvalidation feedbackを返す。plain textで終了しようとした場合は、SDKが構造化出力Toolを一度指定して再度modelへ要求し、それでも拒否すればStructuredOutputErrorとなる。これは追加の自前repairではなく、選択したSDKの標準動作である。

すべて同一invokeのturn/token/deadline上限内で行い、外側でinvokeを再実行しない。不正出力の繰返し、指定後の拒否、token上限、通信失敗を完了と扱わない。Domain Tool budgetにはSDKの出力Toolを数えない。

#781では既存のApplication admissionをZodの`superRefine`からも呼ぶ。最新のEffective Intentと、
初期Evidence・今回のreadを同じ上限でmergeした参照に対して検証する。存在しないfield等をSDK終了後に
初めて検出するのではなく、SDK標準のvalidation feedbackとして同一invoke内でモデルへ返す。
feedbackは閉じた拒否codeと選択方法だけであり、会話や生のEvidence、秘密値をエラーへ含めない。
独自の再invoke・補正・公開fallbackは追加せず、訂正できなければ既存上限で停止する。
最終公開時のEvidence/claim、receipt、currentness、衝突検証とA/B commitは省略しない。

実BedrockのConversation評価も選択モデルに対応する本番と同じ推論設定と4096累積出力tokenを使う。
旧1024上限による途中終了を本番設定の評価と混同しない。6 cycles/2 reads/60秒の上限は維持する。
Conversation fixtureは本番の`explore_destination`を使い、discovery・ページ読込・地点照合を固定Providerで
組成する。mediaのみを渡して本番Promptの目的地調査が実行できないfixtureと混同しない。

## #781の原因確認（2026-10-03）

- 本番の失敗は検索2回とSDK終了の後の`v2:publication:invalid_field`である。選択したfieldは保存されておらず、
  不存在・禁止項目・値の型のいずれだったかを過去ログから確定できない。
- mainの実SDK構成へ同じscripted出力（不存在field・架空ID・禁止URL項目）を与えると、3ケースとも
  不正参照を持ったままSDKが終了する。修正後は同じ入力を標準feedbackで訂正し、readは1回のまま公開まで成功する。
- [実Bedrockの修正前後比較](https://github.com/ymho/transitforge/actions/runs/37105070543)では架空施設の2ケースは
  両方とも`sourceExcerpt`を選んで成功した。この測定では本番の不正field選択を再現できていない。
  同runのmedia-only Conversation fixtureは候補を得られず保存依頼が出力上限に達し、run全体は失敗した。
  fixtureのTool構成を本番へ合わせて再検証する。不成功runを後の成功で消さない。
- [目的地調査を組成した検証](https://github.com/ymho/transitforge/actions/runs/37105455049)では4ターンの
  完了・Trip条件の受理/訂正・未対応保存・replayが成立したが、候補カードのassertionが失敗した。
  固定Providerには公式ページ照合URLと鮮度期限が欠けていた。これらを補い、実モデル呼出し前に
  Tool結果→候補参照→公開カードまで成立する非課金テストを追加した。本番の公開制約は緩めない。
- [最終の実Bedrock検証](https://github.com/ymho/transitforge/actions/runs/37105876800)は5 tests成功。
  会話4ターン（行き先受理・訂正・カード・未対応保存・履歴/replay）と短い説明2ケースが完了し、
  固定Providerの公開テスト2ケースも成功した。実Provider・実ユーザーのブラウザでの再送は未実施である。
  比較用のbranch限定workflow変更は最終差分から除去し、既存main限定の手動評価へ戻した。

## 合否の区別

- 決定論的Acceptance: actual SDK + scripted model。構文拒否、不要な末尾呼出しなし、上限、A/B/history/replay、owner・Evidence拒否。
- `AGENT_V2_LIVE=true npm run test:agent:v2:conversation-live`: actual Bedrock + fixed travel Provider + state fixture。会話4 turnsと短い回答2 cases、最大6 model cycles/turn、各turnは60秒、productionへのwriteなし。
- 実Provider/実ブラウザ: 別の確認。上記の成功で代用しない。

#721のV2専用Frontend表示分離は別作業。今回の公開snapshotの保存契約は維持する。


## 相談から旅程への接続（2026-10-03）

- 普通列車などのダイヤでは`trainName`・`trainNumber`・`serviceType`が空文字になる。
  PublicJourneyの表示検証はDomainに合わせて空文字を許し、serviceUid・駅・時刻を必須のまま保つ。
  検索後のApplication表示変換例外は`presentation/schema_invalid/application-projection`で記録し、
  SDK終了や検索障害、DynamoDB保存障害と区別する。例外本文・検索payloadは記録しない。
- 宿泊Providerの空室応答で検索候補全体を置換しない。確認済み候補を先頭にし、残りを空室未確認として
  最大5件まで比較に残す。`hotelMinCharge`は空室APIから得ても参考最安値として扱い、人数・泊数の合計、
  税込条件へ昇格しない。Toolの検索人数も表示し、旅行人数の受理とは分ける。
- `public-accommodation-presentation-v1`は、最終回答が選んだ宿と同じ検索scopeかつ現行Intentに適用できる
  EvidenceからApplicationが生成する。1件のname参照を選んでも、同じ検索の最大5件を比較カードにする。
  他の検索・古いIntentの候補を混ぜず、空室・参考料金・日付・評価の定義を固定文で表示する。
  原Provider応答・モデル生成カード・画像・座標・予約権限は渡さない。SSE、履歴、replayに同じsnapshotを保持する。
- 空のTripへ旅程作成・反映を求められたら`draft_itinerary`で往路・活動・宿泊・帰路の未選択枠を作れる。
  検索時刻などの不足はunknownsと確認質問へ残し、条件受理だけで作成依頼を完了しない。
- 条件更新と仮旅程作成が同じターンの場合、保持候補は検証済みRequest-only proposal採用後のrevisionに拘束する。
  採用が失敗したターンから候補を公開しない。既存logical day IDは引き継ぎ、相対日程の採用proposalには不足する
  logical dayのtimeline patchを項目と一緒に含める。既存の日・calendar bindingsは保持する。
- 新しい仮旅程は旅程画面の「未保存の旅程案」にも表示する。条件保存後のTripを再読込してtarget/revisionを照合する。
  履歴復元では画面を勝手に開かず、現行revisionと一致する案だけを復元する。
  チャットと旅程画面の両方でpreview→利用者確認→既存CAS保存を使い、表示だけではTripを変更しない。
- 回帰fixtureは報告の5ターンと時刻を明示した追加検索を実SDKで実行し、3宿・出発地の受理・2日分の案・
  空の列車名を含むカード・履歴/replay・preview/confirm保存まで検証する。
  paid laneはホテル・出発地/旅程・鉄道の3ターンに実Bedrockを使い、Providerと永続状態は合成fixtureである。
- 条件Toolの成功応答は`scope=consultation_conditions_only`、`itineraryItemsChanged=false`、
  `researchPerformed=false`を示す。これは実行した条件操作の範囲であり、次のToolをApplicationが選ぶ指示ではない。
  宿検索と案作成の違いはToolの能力説明と公開回答schemaにも示し、条件受理だけを検索・案作成の完了としない。
- 実Bedrockの先行検証では、宿の承諾を案作成と取り違える、出発地の受理だけで終わる、
  案作成後に不要な検索を続けて4096の出力上限へ達する失敗があった。通常CIの成功だけで解消とはしなかった。
  [修正後の相談検証](https://github.com/ymho/transitforge/actions/runs/37123255960)では2 testsが成功し、
  ホテル・出発地/旅程・鉄道の実モデル3ターンはそれぞれ3/4/3 model callsで公開された。
  出力tokenは2117/3363/2153で、上限は変更していない。Tripへの自動保存はなく、別のpreview/confirmを検証した。
  この結果は固定Provider/状態fixtureの成功であり、実Providerの空室・ダイヤや利用者端末の成功を保証しない。
- 同じheadで[会話全体を再測定](https://github.com/ymho/transitforge/actions/runs/37123599473)すると、
  宿検索は成功したがモデルが`candidates`を選び、観光地専用の公開検証で拒否され出力上限へ達した。
  `candidates`にも宿泊の型付き投影を接続し、`answer`と同じ比較カードを使う。
  宿のcandidateReferencesは候補表示できるEvidenceだけを公開し、古い・情報不足の候補や観光地との混在を受理しない。
  モデル生成のカードや価格へfallbackせず、名前・比較説明の双方にEvidence bindingを付ける。
- [独立3回の検証](https://github.com/ymho/transitforge/actions/runs/37124368433)では宿の`candidates`公開は成功したが、
  完全な相談フローは1/3だった。1回は出発地受理後に案を省略し、もう1回は宿検索を案作成へ取り違えた。
  そのため、このheadをマージせず、今回の生発言をSDKの独立した末尾TextBlockで渡す入力投影へ変更した。
  applicationは別TextBlockのJSONデータとし、既存24k予算・role/textだけの履歴・Effective Intentの正本を保つ。
  発言の意味をApplicationで推測したり、Tool選択や追加invokeを行う変更ではない。
- [生発言を分けた独立3回の検証](https://github.com/ymho/transitforge/actions/runs/37125364755)も完全なフローは0/3だった。
  条件受理後に案を省略、鉄道の後に宿を再検索して回答拒否・出力上限、宿検索省略と条件Tool拒否が残った。
  Live fixtureが検索ごとの実Observation IDを固定`hotel-1`等へ上書きしていたため、再検索時に過去Evidenceと
  衝突し得た。Liveでは本番と同じIDを保持し、短い固定IDはscripted fixtureだけに限定する。
  Tool失敗の診断も既知の閉じた拒否codeだけを追加し、SDKのエラー本文・生成内容は記録しない。
  今回依頼した検索だけを行うこと、宿の承諾と空のTripへの反映を区別することを一般的な会話例で明示する。
  この変更も固定ルーティングやTool順の強制、予算拡大ではない。
- [Observation IDを保持した独立3回](https://github.com/ymho/transitforge/actions/runs/37125967575)も0/3だった。
  検索と宿カードの公開は2回成功したが、空のTripへの案作成を省略し、1回は`invalid_source`、
  1回は`malformedToolUse`も観測した。参照ID修正をモデルの依頼完了性の解消と混同しない。
  [基本2ケース](https://github.com/ymho/transitforge/actions/runs/37126149764)も未対応保存の応答型が不安定だった。
  条件・検索・案・未対応操作を重複して記述していたPromptを整理し、実行能力と現在依頼の完了条件を
  先頭の短い英語policyへまとめる。公開回答の言語は日本語のまま、既存の期間・仮定・Evidence・Trip境界を維持する。
- [policy整理後の3回](https://github.com/ymho/transitforge/actions/runs/37126745363)も0/3だった。
  この測定では宿カード公開は1回成功したが、今回発言にない出発地・期間のwriterを呼ぶ失敗や案作成省略が残った。
  複数TextBlockの暗黙的な位置で現在発言を示すのをやめ、単一TextBlockの`application_reference`と
  `current_user_message`ラベルで参考JSONと生発言を明示する。履歴とTool結果を現在の依頼と混同しない方針も示す。
  ラベルはデータ境界だけで、推測した意味・作業一覧・Tool選択は含まない。ラベル込みでも24k上限を検証する。
- [入力境界を明示した3回](https://github.com/ymho/transitforge/actions/runs/37127291804)も0/3で、
  [Nova 1 Liteとの3回比較](https://github.com/ymho/transitforge/actions/runs/37127710826)も0/3だった。
  前者は宿検索省略・未依頼の条件操作、後者はアクセス検索反復・構造化回答拒否が残った。
  次にNova 2 Liteの推論無効（Providerの既定）とlowを比較する。モデル選択・turn/output/deadline上限は変えず、
  この段階では本番のlow設定を維持する。比較fixtureの成功を本番設定の成功と扱わない。
- 鉄道Toolは出発時刻を必要とする一方、公開質問schemaに出発時刻のtargetが存在しない契約の不一致もあった。
  `clarification`と`nextQuestion`に`departure_time`を追加し、日付への誤分類を不要にする。
  SDK構文とApplication公開の双方で時刻質問を受理する回帰を追加する。これは条件の自動保存権限を追加しない。

- [Nova 2推論無効の3回比較](https://github.com/ymho/transitforge/actions/runs/37128346491)も0/3で、
  宿の承諾ターンで期間writerを8回繰り返していた。比較fixtureを本番と同じlowへ戻す。
  追加診断はquoteが今回発言/履歴に含まれるかの真偽とschemaの許可済みfield名に限定し、
  元の発言・quote・モデル生成内容・任意のpathは記録しない。

- [時刻質問を追加したlowの検証](https://github.com/ymho/transitforge/actions/runs/37129063372)では、
  出発地受理・2日分の案・経路公開・確認保存まで成功したが、宿の承諾を案作成へ取り違えて全体は失敗した。
  既存low/推論無効/Nova 1の比較だけでは完了性を満たしていないため、次にmediumを同じturn/token/deadline上限で比較する。
  この比較時点では本番lowを変更しない。Engineの明示設定にmediumを追加し、SDKへの設定伝達を検証する。

- [mediumの比較](https://github.com/ymho/transitforge/actions/runs/37129528633)でも全体は失敗した。
  宿の承諾ターンの期間writerでquoteは今回発言に含まれず、過去発言に含まれていた。
  mediumは採用せずfixture/Engine設定をlowへ戻す。Applicationの拒否自体は維持し、SDKのnative Tool errorに
  「今回発言だけを根拠にする」「受理済み条件は再登録せず検索へ利用できる」という閉じた説明を追加する。
  自由文・quoteの再出力、条件の補正、外側retry、Tool選択の強制は行わない。

- draft_itineraryの成功応答にも`scope=unsaved_itinerary_only`、`researchPerformed=false`、
  `tripItemsChanged=false`を明示する。保持した案の作成成功だけを検索・保存成功と扱わないための実行scopeであり、
  次のTool選択や旅程採用をApplicationが強制するものではない。

- [native拒否説明後の検証](https://github.com/ymho/transitforge/actions/runs/37130027923)では過去quoteのwriter反復は止まったが、
  宿検索を省略したまま回答して全体は失敗した。出発地/案/経路/保存は成功した。
  SDKのcurrent user-roleメッセージに参考状態と過去provenance quoteを含めていた入力境界を整理する。
  現在のuser-roleは生発言だけ、sanitized Application referenceはpolicyと区別したsystem-context DATAへ渡す。
  Native履歴、正本のEffective Intent、24k合算予算を保ち、JSON値のdelimiter文字はescapeする。
  この変更は新たな意味解釈や権限を加えず、現在発言の実roleとApplicationのsource検証を一致させる。

- [role境界整理後のNova 2検証](https://github.com/ymho/transitforge/actions/runs/37130567269)では宿3件は公開されたが、
  出発地受理後に経路検索へ進み、案作成を省略して全体は失敗した。通常テストの成功と区別する。
- 同じSDK・固定Provider・上限で`jp.anthropic.claude-sonnet-4-6`を比較した。
  [初回](https://github.com/ymho/transitforge/actions/runs/37131766927)は全フローが成功し、
  [独立3回](https://github.com/ymho/transitforge/actions/runs/37132017737)は宿比較・案作成3/3、保存まで2/3だった。
  1回は後の経路依頼で同じ出発地を再登録し、Trip revisionが更新されて古い案のpreviewが競合になった。
  この拒否を解除せず、検索パラメータとして既知条件を述べることと変更依頼をPromptで区別する。
- 時刻未指定で勝手な8時検索を通さないassertionを追加した
  [より厳密な独立3回](https://github.com/ymho/transitforge/actions/runs/37132846895)は全フロー0/3だった。
  2回は未指定時刻の検索、1回は時刻質問で案作成を省略した。前の成功をこの条件での成功とは扱わない。
  指定後の検索は日付・駅・8時の実Tool引数も検証する。駅名はToolが受理する「駅」有無を許す。
- 次の比較は同じClaudeモデルの標準adaptive thinking/mediumで行った。temperatureは指定せず、
  thinkingを含む累積出力4096とturn/read/deadlineの上限は維持する。本番compositionはNova 2/lowのまま。
  外側retry、段階別toolChoice、独自の意味分類や旧Runtimeへのfallbackは追加しない。
  参考: [AWS adaptive thinking/Converse](https://docs.aws.amazon.com/bedrock/latest/userguide/claude-messages-adaptive-thinking.html)。
- 宿3件のSSE→表示用投影→DOM→履歴再表示の回帰も実行する。旧`ViewerAgentResponse`を通しても
  カード数・未確認料金の表示・安全な文字表示を維持する。旧表示unionの分離は#721に残り、
  この測定だけでv1関連コードを一括削除可能とはしない。公開artifactの`-v1`はデータ形式の版であり、旧実行エンジンの選択ではない。

- [adaptive/mediumの初回](https://github.com/ymho/transitforge/actions/runs/37133525658)は、時刻未指定の検索禁止を含む全フロー2/2を通過した。
  本番と同じNative Bedrock設定をEngineの明示オプションとcomposition共通選択へ移し、fixtureだけのmodel注入を外す。
  thinking時のtemperature未指定、4096上限、Nova設定との排他、本番compositionとpaid fixtureの一致を回帰で確認する。
  モデル選択の本番切替・mergeは独立3回と周辺の有料回帰の完了後に判断する。

- [adaptive/mediumの独立3回](https://github.com/ymho/transitforge/actions/runs/37134261839)は全フロー3/3、各2テストを通過した。
  同じ設定をEngine/rootから使う[Conversation周辺回帰](https://github.com/ymho/transitforge/actions/runs/37134679096)も8/8を通過した。
  CDのdev選択を日本国内profileのSonnet 4.6へ切り替え、MODEL_IDもAWSから読み戻して一致を検証する。
  Terraformの再利用既定はNovaのまま。SDKの上限は増やさず、実空室・実ダイヤ・利用者端末は別の確認として残す。
  Sonnetの料金はNovaと同一とは扱わない。日本国内profileの標準単価は入力$3.30/出力$16.50（100万token当たり）。
  固定Providerで一部ターンだけ実モデルにした測定費用を、実利用の全会話料金として見積もらない。
  参考: [Anthropic公式のBedrock価格表](https://www-cdn.anthropic.com/files/4zrzovbb/website/3684c2faafb97418665782cea0001f439f74b1d2.pdf)。

- [基本2ケースの独立3回](https://github.com/ymho/transitforge/actions/runs/37134952374)は根拠付き回答3/3、未対応保存1/3だった。
  未対応保存の2回は保存成功の偽装ではなくclarificationを返したが、能力不足を明示する契約を満たさない。
  clarificationのSDK schema説明へ、提供できる能力の入力不足だけを質問し、能力不足はunavailableを使う区別を追加する。
  利用者発話の文字判定、外側retry、回答の強制変換は追加しない。
