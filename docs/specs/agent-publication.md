# Agent v2の構造化出力と公開境界

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
本文・質問・短い会話文は、既存の`marked`で解析してから許可したMarkdownだけを再出力する。
太字・強調・見出し・箇条書き／番号付きリスト・コードは保持し、エスケープ済みの通常記号を再解釈しない。
モデルが書いたリンク（自動リンク・参照リンクを含む）・画像・HTMLは文字列として表示し、URLを有効化しない。
節の見出しと資料の直接引用は従来どおりliteralとして扱う。クリック可能な出典は検証済みEvidenceから
Applicationが別途生成する。FrontendはHTMLへ変換せず既存の安全な表示モデル／DOMを使う。

## 宿泊検索の条件不足

意味preconditionの拒否は、閉じたcodeと`recovery={kind:resolve_conditions,target,inputField,reason}`を
SDKへ返す。利用者の入力値・生のエラー本文・Provider本文は含めない。条件不足／未受理／未定／精度不足／
古い値を検索障害や待ち時間として案内しない。目的地が未受理で今回の実際の行き先が明示されている場合は、
既存の`update_current_destination`による受理後に検索する。既知の目的地は検索地域の指定だけで上書きせず、
過去発言をwriterのquoteへ流用しない。登録できなければ不足項目と旅行条件または会話からの登録方法を案内する。
人数登録後や日付登録後でも目的地の条件検証を省略しない。Provider障害はこのrecoveryへ変換しない。

`strands-accommodation-preconditions.test.ts`はnative SDKと本番Tool組成を使い、鉄道照会→人数登録→
宿検索拒否→日付だけ登録しても拒否→行き先受理後の宿検索・カード・履歴・replayを確認する。
モデル／Provider／DynamoDBは合成fixtureで、実モデルの意味理解品質や本番画面の確認とは区別する。

Frontendはcurrentな回答を表示した後、actualな条件の受理receiptがあればTripをServerから再取得する。
回答の表示前やSSE受信中にrevisionを更新して、自分の応答をstaleとして破棄しない。receiptの値をBrowserで
Tripへ転記しない。履歴再表示・別会話の遅延応答・拒否のみのreceiptでは再取得しない。再取得失敗時は既存の
unavailable表示とし、古い条件を最新情報として残さない。

## SDKの再試行を隠さない

採用SDKは不正な構造化出力にvalidation feedbackを返す。plain textで終了しようとした場合は、SDKが構造化出力Toolを一度指定して再度modelへ要求し、それでも拒否すればStructuredOutputErrorとなる。これは追加の自前repairではなく、選択したSDKの標準動作である。

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

## Agent v2: 自由な対話と受理条件の表示

conversation / clarification / uncertaintyは任意のtext（1〜600文字）で、確認・補足・仮定・不確実性を説明できる。
SDK structured outputのまま公開し、lastMessageの抜取り、外側repair、独自loopや発話regexは追加しない。
自由文はEvidenceや操作の権限ではない。answer/candidatesの実在Evidence、operation_resultの同一実行receipt照合は維持する。
自然文の意味の完全な正しさはスキーマだけで証明しない。外部事実や操作成功を作らないことはモデルの品質としても検証する。

Applicationが実Controllerの受理記録と現在のEffectiveIntentをoperation IDで照合し、「今回の相談条件（反映済み）」を表示する。
受理記録なし・拒否・失効した旧receiptから成功表示を作らない。表示は現在値だけで、内部ID・来歴quote・Profile推測を含めない。
最終16KB上限と既存B commitを通り、SSE/history/replay共通になる。Trip保存や予約の成功を意味しない。
既知の条件でも文脈付きの確認質問は可能とし、固定の同じ値を聞く質問だけを従来通り拒否する。

## SDK標準の会話履歴

通常の認証済みConversation組成・owner-scopedの履歴loaderで取得した公開user/assistant本文だけを、
Strandsの`AgentConfig.messages`へ渡す。履歴をJSON内の参考データとして重複して埋め込まない。
現在のuserMessageとApplication状態の入力は分離したまま、結合前の全データに従来24kの上限とprivate field除去を適用する。
raw Tool結果・内部思考・system roleを会話履歴から作らず、不正なrole/textを拒否する。
元のConversationが保存の正本であり、SDK sessionや別の会話保存先を作らない。

JSONに履歴を埋め込んだ旧試験run 36298787600では自由文は全18ターンで返ったが、
『大阪です』を出発地ではなく行き先として受理するため3反復とも失敗した。発言・期待する保存値は変更せず、
SDK標準履歴へ移した同じ6ターンを再検証する。決定論的テストでは実SDKへ渡ったroleと順序も確認する。

## 出力上限と検証

maxOutputTokens（モデル1回）とmaxInvocationOutputTokens（累積実行）を分け、本番は4096/4096を明示して従来上限を維持する。
人数指定→『大阪です』→人数what-if→実際の訂正→出発地撤回→お礼という会話で、保存値と受理表示、
what-ifのwriter callback0、無関係な条件の維持、B replayと履歴の一致を検証する。
`AGENT_V2_LIVE=true MODEL_ID=jp.amazon.nova-2-lite-v1:0 npm run test:agent:v2:free-dialogue-live`は実モデルの6ターン。
各最大6 calls・60秒、model出力1536、累積4096。通常CIでは課金liveを実行しない。

#729の匿名cohort/参加scope writerはこの先行sliceに含めない。#734での同一what-if再現は自由文対応後3/3完了したが、
対象が未定なのにcohortを更新する試験は3/3失敗した（run 36297796327）。短い対象補足・逆訂正後の保存値は成功したものの、
これを全体成功とは扱わず、#734/#736の課題として残す。推論設定比較run 36298032840も完走せず、本番の推論設定は変えない。
自由文の先行反映でこの未解決のwriterを公開しない。

## Agent v2の場所候補カード

## 最小の公開契約

代表readは既存の`search_place_media`。写真の取得成功を前提にせず、`externalTravelEvidence`が作る解決済み場所の`place_description`だけを候補カードへ使う。
モデルは`SDK structured output`の`kind=candidates`でEvidence IDの順序と根拠付きcommentaryを選ぶ。場所名、説明、出典URLはApplicationがEvidenceから投影し、モデルのカードpayloadを受け取らない。

`PublicPlacePresentation`はConversationへ保存する表示snapshotであり、Trip、旅程、採用候補セット、第二の永続候補ストアではない。#755以降は、同じEvidenceへ束縛されたHTTPS画像・写真ページ・attribution・任意licenseだけを任意の`photo`として含める。価格、空室、営業状態、保存・予約の結果はこの型へ入れない。

```text
Strands → 必要ならupdate_intent / A commit
  → 既存旅行read → Evidence / candidateReferences
  → SDK structured output(candidates) → Applicationの参照・claim検証
  → B commit → final SSE → 共通UI投影
                ↘ owner-scoped履歴 / replay → 同じUI投影
```

## V2終端プロトコル

SDKのstructuredOutputSchema/structuredOutputへ統一する。独自ToolChoice切替は撤去した。詳細は[公開境界](agent-publication.md)を参照。

## 会話での候補選択と旅程への保存

## 履歴と選択対象

SDKの会話履歴には従来どおり利用者発言と公開回答本文を渡す。これとは別に、同じownerの確定済み公開表示から直近の候補を取得し、種別・表示順・候補ID・名前をApplication referenceへ渡す。直近12メッセージの範囲で種別ごとに最新の候補群を使う。本文から候補や保存内容を復元しない。

- 候補なしの「この条件を保存して」には引数なしの`review_presented_candidates`で対象を確認し、Applicationのmissing/navigationに基づく`clarification / itinerary_target`で旅程画面の相談・追加導線を案内する。条件は既存の条件受理で反映済みである。
- 複数候補への「保存して」には`review_presented_candidates`で同じ公開表示を再送し、`clarification / candidate_selection`で選択を尋ねる。再検索・保存は行わない。再表示にも元の保持済み採用参照を付け、次の会話から選べるようにする。
- 旅程案・ホテルなど複数の候補群が同居するときは、確認Toolのschemaで表示済み群IDを必須enumにする。群IDなしの確認が`ambiguous`で終わり、選び直すカードが欠落する経路を防ぐ。候補なし・一群だけの確認は従来どおり引数省略を許す。群を確認するだけでは採用・保存しない。
- 「経路1でお願いします」「案2でお願いします」など一意な採用依頼では`select_presented_candidate`が今回の引用と確定済みIDだけをApplicationへ渡す。複数群・同名候補・追加先が曖昧なら選択を求める。比較・仮定・否定は採用ではない。

## 副作用の境界

保存対象なしのinspection結果はApplicationのnavigationとして応答の受理にも結び付ける。別の質問targetはSDKの構造化出力検証で拒否し、正しいtargetが選ばれた場合だけApplicationの相談導線を表示する。自由文のfallbackや発話の語句判定ではない。

モデルは保存DTO、候補スナップショット、確認キーを作らない。Applicationが保持済み候補を解決し、ボタンと同じ`PlanCandidateAdoptionApplication`のpreview/confirm、owner、期限、Trip revision、予約保護、Proposal CAS、mutation receiptを通す。期限は初回の実書込み時にも確認する。既に成功した同じmutationの再送は期限後も保存済みreceiptを読み戻し、書込みを増やさない。

選択には今回の発言中の名前または表示番号の引用も必要で、Applicationが対象の表示名・番号と照合する。同名候補や、発言に出ていない別案、複数候補を唯一の候補とする指定は受理しない。否定・仮定・採用の意味解釈はモデルの責務であり、名前・番号の照合だけで肯定的な同意を保証したとは扱わない。

mutation IDは認証済みconversationとuser sequenceから決定し、1つの利用者turnで別の候補を追加保存しない。曖昧な保存失敗は成功として公開せず、そのSDK実行の後続処理を閉じる。SDKのnative loopと構造化応答だけを使い、独自の再試行、語句判定ルーター、v1へのfallbackは追加しない。

成功時だけ`operation_result`を実receiptで認可する。公開`tripMutationReceipt`はTrip IDと保存後revisionだけを持ち、final、B commit、履歴、再送を共通化する。現在の応答を受けた画面はTripを再取得する。履歴の表示で保存を再実行しない。

## 経路と宿泊

経路は検索に用いた同じ時刻表入力から検証済みrail snapshotを作り、保持済み候補へ結び付ける。表示と元データの関連は全区間・列車・時刻を含む表示スナップショットで照合し、駅名や「経路1」だけで別検索の結果を対応させない。リアルタイムの遅延表示を予定時刻として保存しない。未選択枠が複数の場合は明示的なfocused itemを優先し、ない場合は検証済み候補の日付・タイムゾーンが全候補で同じ一枠へ一致する場合だけ保存先を特定する。日付の照合方針と曖昧な場合の拒否は[製品横断評価](../operations/testing.md)に記す。

宿泊は既存の`selectAccommodation`を使う。2026-10-04の利用者の保存許可を受け、旅程へ採用する最小の施設参照を本番検索から保持する。Rakuten adapterは`provider=rakuten-travel`で実サービスを識別する。公式APIの`hotelNo`は施設番号であり、`hotelName`と同じ構造化レスポンスから施設の対応を確定できる。任意の宿泊商品IDから施設IDを作る汎用変換は行わない。

`rakutenAccommodationSelectionEvidence`はホテル名・施設ID・宿泊日・取得元・取得時刻に限るApplicationの保持方針を適用する。`sources.attribution=楽天トラベル`も保存する。この方針を外部提供元による包括的な複製許諾と扱わず、検索時の参考価格と、写真URL・評価・詳細URLを観測日時付きの表示情報として保持する。説明文・空室・住所・座標・raw responseは採用Snapshotへコピーしない。モデル/UIは保持方針や施設情報を自己申告できない。

`VerifiedAccommodationSelections`は同じTool呼出しの実Offering、保持証拠、Evidence ID、日付と公開カードを照合し、実際に表示した候補だけを既存候補Repositoryへ保持する。再検索の別日程・同名施設・重複ID・対応の衝突から保存対象を推測しない。既存の無修飾`travel-provider`結果は表示できるが、新しいサービス同定へ自動昇格しない。会話・ボタンは同じ採用処理を使う。

## 宿泊比較カードの表示

採用案と結合した候補は均等幅のタブで切り替える。宿泊日・人数・参考料金はラベルと値を揃え、空室・料金条件は淡い青背景のお知らせ欄へまとめる。旅程の黄色い注意欄とは表示を区別する。評価は5点満点の星と数値を併記する。Providerの画像URL・評価・サービス識別子はEvidenceから公開カードへ渡し、SSEと会話履歴で共通表示する。HTTPSの検証済み画像だけ表示し、取得失敗時は画像を外す。楽天トラベルのカードは下端へ小さい提供元クレジットを置く。利用者の2026-10-11の依頼により、写真URL・評価・詳細URLを採用時の観測情報として旅程へ保持する。旧カードはsummaryから表示でき、写真や取得元を推測しない。

宿泊検索の10候補をすべて採用候補として保持し、各候補の採用操作を維持する。空室あり／未確認は情報欄で明示し、楽天クレジットは幅140pxを基本とする。

宿泊比較パネルは全候補で同一の宿泊日・人数を共通条件として一度だけ表示し、各宿の情報は評価・参考最安値（または指定日の参考料金）・空室状況の順に表示する。Provider応答に施設特色・口コミがある場合だけ短い紹介文を表示する。文章は取得済み応答から抜粋し、追加のHTTP検索やモデル呼び出しを行わない。口コミ1件を全体の評判に一般化せず投稿例と明示する。情報がない場合は紹介欄を作らない。

宿泊比較の補足文章は折りたたまず通常の回答本文に表示する。施設紹介と口コミは各300文字までとし、「続きはこちら」「続きを読む」の遷移できない案内を除去する。履歴から復元した宿泊パネルと旅程画面の詳細リンクも、表示中の宿泊日に合わせて楽天のプランページへ変換する。過去に保存した日付なしのURLも対象とする。
