# 会話での候補選択と旅程への保存（#784）

## 履歴と選択対象

SDKの会話履歴には従来どおり利用者発言と公開回答本文を渡す。これとは別に、同じownerの確定済み公開表示から直近の候補を取得し、種別・表示順・候補ID・名前をApplication referenceへ渡す。直近12メッセージの範囲で種別ごとに最新の候補群を使う。本文から候補や保存内容を復元しない。

- 候補なしの「この条件を保存して」には引数なしの`review_presented_candidates`で対象を確認し、Applicationのmissing/navigationに基づく`clarification / itinerary_target`で旅程画面の相談・追加導線を案内する。条件は既存の条件受理で反映済みである。
- 複数候補への「保存して」には`review_presented_candidates`で同じ公開表示を再送し、`clarification / candidate_selection`で選択を尋ねる。再検索・保存は行わない。再表示にも元の保持済み採用参照を付け、次の会話から選べるようにする。
- 「経路1でお願いします」「案2でお願いします」など一意な採用依頼では`select_presented_candidate`が今回の引用と確定済みIDだけをApplicationへ渡す。複数群・同名候補・追加先が曖昧なら選択を求める。比較・仮定・否定は採用ではない。

## 副作用の境界

保存対象なしのinspection結果はApplicationのnavigationとして応答の受理にも結び付ける。別の質問targetはSDKの構造化出力検証で拒否し、正しいtargetが選ばれた場合だけApplicationの相談導線を表示する。自由文のfallbackや発話の語句判定ではない。

モデルは保存DTO、候補スナップショット、確認キーを作らない。Applicationが保持済み候補を解決し、ボタンと同じ`PlanCandidateAdoptionApplication`のpreview/confirm、owner、期限、Trip revision、予約保護、Proposal CAS、mutation receiptを通す。期限は初回の実書込み時にも確認する。既に成功した同じmutationの再送は期限後も保存済みreceiptを読み戻し、書込みを増やさない。

選択には今回の発言中の名前または表示番号の引用も必要で、Applicationが対象の表示名・番号と照合する。同名候補や、発言に出ていない別案、複数候補を唯一の候補とする指定は受理しない。否定・仮定・採用の意味解釈はモデルの責務であり、名前・番号の照合だけで肯定的な同意を保証したとは扱わない。

mutation IDは認証済みconversationとuser sequenceから決定し、1つの利用者turnで別の候補を追加保存しない。曖昧な保存失敗は成功として公開せず、そのSDK実行の後続処理を閉じる。SDKのnative loopと構造化応答だけを使い、独自の再試行、語句判定ルーター、v1へのfallbackは追加しない。

成功時だけ`operation_result`を実receiptで認可する。公開`tripMutationReceipt`はTrip IDと保存後revisionだけを持ち、final、B commit、履歴、再送を共通化する。現在の応答を受けた画面はTripを再取得する。履歴の表示で保存を再実行しない。

## 経路と宿泊

経路は検索に用いた同じ時刻表入力から検証済みrail snapshotを作り、保持済み候補へ結び付ける。表示と元データの関連は全区間・列車・時刻を含む表示スナップショットで照合し、駅名や「経路1」だけで別検索の結果を対応させない。リアルタイムの遅延表示を予定時刻として保存しない。未選択枠が複数の場合は明示的なfocused itemを優先し、ない場合は検証済み候補の日付・タイムゾーンが全候補で同じ一枠へ一致する場合だけ保存先を特定する。日付の照合方針と曖昧な場合の拒否は[製品横断評価](trip-v2-product-evaluation.md)に記す。

宿泊は既存の`selectAccommodation`を使う。2026-10-04の利用者の保存許可を受け、旅程へ採用する最小の施設参照を本番検索から保持する。Rakuten adapterは`provider=rakuten-travel`で実サービスを識別する。公式APIの`hotelNo`は施設番号であり、`hotelName`と同じ構造化レスポンスから施設の対応を確定できる。任意の宿泊商品IDから施設IDを作る汎用変換は行わない。

`rakutenAccommodationSelectionEvidence`はホテル名・施設ID・宿泊日・取得元・取得時刻に限るApplicationの保持方針を適用する。`sources.attribution=楽天トラベル`も保存する。この方針を外部提供元による包括的な複製許諾と扱わず、価格・写真・説明文・レビュー・空室・予約URL・住所・座標・raw responseは採用Snapshotへコピーしない。モデル/UIは保持方針や施設情報を自己申告できない。

`VerifiedAccommodationSelections`は同じTool呼出しの実Offering、保持証拠、Evidence ID、日付と公開カードを照合し、実際に表示した候補だけを既存候補Repositoryへ保持する。再検索の別日程・同名施設・重複ID・対応の衝突から保存対象を推測しない。既存の無修飾`travel-provider`結果は表示できるが、新しいサービス同定へ自動昇格しない。会話・ボタンは同じ採用処理を使う。

## 確認

`strands-candidate-selection.test.ts`は実SDKを通して候補なし、単一、複数、番号選択、状態・履歴・再送を確認する。`AGENT_V2_LIVE=true`では選択turnだけを実Bedrockで実行し、初期候補とProviderは合成fixtureを使う。`verified-search-selection.test.ts`は元時刻表、再検索・部分公開の関連、保存許可、追加先の曖昧さ、同じ採用処理・期限後receipt再送を確認する。SSEと履歴の契約テストは不正receiptを拒否する。

`strands-accommodation-selection.test.ts`は合成API応答を実Http adapter→IAM Invoke契約→Server Tool→公開カード→履歴→会話選択→Trip保存へ通す。複数候補の再表示、名前/番号指定、単一候補の保存、未選択Stayの置換、保存内容、所有者境界、再検索しないこと、再送の重複防止を確認する。`AGENT_V2_LIVE=true`では選択turnを実Bedrockで実行する。実Provider・実画面を含む本番旅行全体の成功とは区別する。

## 2026-10-04の実モデル確認

本番と同じ`jp.anthropic.claude-sonnet-4-6`、Strands SDK、合成状態・固定Providerで評価した。モデル呼出し・出力・Toolの上限とテスト期待を緩めず、失敗を修正してから独立3回を実行した。

途中の検証では、候補なしの`goal`質問、否定から別案を保存する解釈、番号引用の不正な形式が失敗した。保存対象のinspection、Application navigationの応答受理、選択対象と現在発言の引用照合を追加した。条件保存の丁寧な発言ではinspectionを省略するケース、既存相談では未指定の出発時刻を推測するケースもあり、候補なしの条件保存と時刻未定の仮旅程の指示を補強した。これらの途中runを成功とは数えない。

挙動の最終変更`5c568640afcd4a294e26eec70d85678924ffc527`の[Actions run 37170064368](https://github.com/ymho/transitforge/actions/runs/37170064368)で、次を確認した。

| 範囲 | 結果 |
| --- | --- |
| 候補なし・単一・複数・番号指定・否定・仮定・検索済み経路選択 | 7ケース × 独立3回すべて成功 |
| 既存の旅程作成確認、宿比較・出発駅反映・経路検索・採用・再送 | 2ケース × 独立3回すべて成功 |
| Evidence回答・未対応予約・履歴なしの条件保存 | 3ケース × 3回すべて成功 |

同じ挙動の`3a5bf10f147dec8f7543eddcb3705ab9f783c5e0`の[Actions run 37170356201](https://github.com/ymho/transitforge/actions/runs/37170356201)では、#784の「挨拶→出雲大社→清水寺への訂正とカード→この候補を保存して」も選択turnを実モデルで独立3回確認した。3回とも上限内で完了し、Trip itemの追加・条件の再更新・再検索・再送時のモデル呼出しはなかった。初期3turnは実SDKの固定model、観光Providerと状態は合成fixtureである。

実データの旅行検索、実画面操作、本番ホテルの選択保存はこのLive確認に含めていない。否定・仮定のあらゆる表現が保証されたとも扱わない。評価のためのbranch限定push workflowはマージ差分から外す。

## 2026-10-04: ホテル施設参照の保存確認

最小参照の保持を接続した`50d919fb697019228b295cd8170da475e4b51cfa`の[Actions run 37174189101](https://github.com/ymho/transitforge/actions/runs/37174189101)で、本番と同じSonnetによる選択turnを独立3回確認した。複数候補への曖昧な保存依頼、ホテル名指定、番号指定、単一候補の保存の4ケース×3回がすべて成功した。上限・期待値は緩めていない。

初期検索は実SDKの固定modelで、Providerは合成API応答を実Http adapterと固定egressのhandler/Invoke契約へ通す。選択turnは実Bedrock/Strandsである。Tripと会話の状態はDynamoDB契約fixtureを使う。保存された宿泊先のホテル名、rakuten-travelの施設ID、楽天トラベルのサービス名、宿泊日と出所、既存Stayの置換、他所有者からの非公開、履歴receipt、再送時の重複防止・再検索なしを確認した。実ホテルAPI・実AWS保存・実画面操作のE2Eを実施したとは扱わない。

ローカルでは`test:agent:v2`の340成功/1skip、全`npm test`（Frontend 1756、Backend 1459成功/15skip、stream 5、live fixture 9）、`workspace:check`、`architecture:check`、`build`を確認した。評価のためのbranch限定workflowは元に戻し、マージ差分から外す。
