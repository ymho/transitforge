# 会話での候補選択と旅程への保存（#784）

## 履歴と選択対象

SDKの会話履歴には従来どおり利用者発言と公開回答本文を渡す。これとは別に、同じownerの確定済み公開表示から直近の候補を取得し、種別・表示順・候補ID・名前をApplication referenceへ渡す。直近12メッセージの範囲で種別ごとに最新の候補群を使う。本文から候補や保存内容を復元しない。

- 候補なしの「この条件を保存して」には`clarification / itinerary_target`で保存対象がないことと旅程画面の相談・追加導線を案内する。条件は既存の条件受理で反映済みである。
- 複数候補への「保存して」には`review_presented_candidates`で同じ公開表示を再送し、`clarification / candidate_selection`で選択を尋ねる。再検索・保存は行わない。再表示にも元の保持済み採用参照を付け、次の会話から選べるようにする。
- 「経路1でお願いします」「案2でお願いします」など一意な採用依頼では`select_presented_candidate`が今回の引用と確定済みIDだけをApplicationへ渡す。複数群・同名候補・追加先が曖昧なら選択を求める。比較・仮定・否定は採用ではない。

## 副作用の境界

モデルは保存DTO、候補スナップショット、確認キーを作らない。Applicationが保持済み候補を解決し、ボタンと同じ`PlanCandidateAdoptionApplication`のpreview/confirm、owner、期限、Trip revision、予約保護、Proposal CAS、mutation receiptを通す。期限は初回の実書込み時にも確認する。既に成功した同じmutationの再送は期限後も保存済みreceiptを読み戻し、書込みを増やさない。

選択には今回の発言中の名前または表示番号の引用も必要で、Applicationが対象の表示名・番号と照合する。同名候補や、発言に出ていない別案、複数候補を唯一の候補とする指定は受理しない。否定・仮定・採用の意味解釈はモデルの責務であり、名前・番号の照合だけで肯定的な同意を保証したとは扱わない。

mutation IDは認証済みconversationとuser sequenceから決定し、1つの利用者turnで別の候補を追加保存しない。曖昧な保存失敗は成功として公開せず、そのSDK実行の後続処理を閉じる。SDKのnative loopと構造化応答だけを使い、独自の再試行、語句判定ルーター、v1へのfallbackは追加しない。

成功時だけ`operation_result`を実receiptで認可する。公開`tripMutationReceipt`はTrip IDと保存後revisionだけを持ち、final、B commit、履歴、再送を共通化する。現在の応答を受けた画面はTripを再取得する。履歴の表示で保存を再実行しない。

## 経路と宿泊

経路は検索に用いた同じ時刻表入力から検証済みrail snapshotを作り、保持済み候補へ結び付ける。表示と元データの関連は全区間・列車・時刻を含む表示スナップショットで照合し、駅名や「経路1」だけで別検索の結果を対応させない。リアルタイムの遅延表示を予定時刻として保存しない。未選択枠が複数なら明示的なfocused itemが必要で、自動的に往路・帰路を選ばない。

宿泊は既存の`selectAccommodation`を共通Domainへ移し、施設同定と提供元の保存許可の両方を持つ証拠がある場合だけ保持できる。価格・画像・空室・予約URLを無条件に保存しない。現行の本番Rakuten adapterにはこの信頼済み許可情報と独立した施設情報の接続がないため、本変更だけで本番ホテルカードを選択済みStayとして保存できるとは扱わない。カードの比較・再表示は可能で、保存対象を解決できない場合は制約を応答する。fixtureの架空の許可を本番へ転用しない。

## 確認

`strands-candidate-selection.test.ts`は実SDKを通して候補なし、単一、複数、番号選択、状態・履歴・再送を確認する。`AGENT_V2_LIVE=true`では選択turnだけを実Bedrockで実行し、初期候補とProviderは合成fixtureを使う。`verified-search-selection.test.ts`は元時刻表、再検索・部分公開の関連、保存許可、追加先の曖昧さ、同じ採用処理・期限後receipt再送を確認する。SSEと履歴の契約テストは不正receiptを拒否する。

これは実Provider・実画面を含む本番旅行全体の成功を意味しない。本番ホテルの保持証拠と、focused itemを決める相談導線の利用は別途確認する。
