# 旅程条件の単一正本化（#761）

Parent: #753 / Epic #751

## 正本と責務

採用済みの今回条件は`Trip.request`を正本とする。Conversation Working Stateのsemantic overlayは、
まだTripへ採用されていない条件操作だけを保持し、採用後に同じ値を第二の正本として残さない。
次回Agent Contextと条件パネルは、現在のTripと未採用overlayを同じEffective Intent compilerへ渡して導出する。

Strands Adapterは、同じtargetを以前呼んだという理由で成功を返さない。全ての条件操作をApplicationへ渡す。
永続化境界は、同一turn・target・payloadの再送を元のreceiptへreplayし、異なるpayloadの訂正や撤回を
新しい操作として保存する。自由文、固定文言、正規表現で再送や採用を分類しない。

## 受理からTrip採用まで

1. 条件ToolをApplicationが検証し、Working Stateのoverlayとoperation receiptを同じCAS transactionで保存する。
2. Server compositionは、現在のTrip、Effective Intent、accepted receiptからverifiedなrequest Proposalを決定論的に作る。
3. Proposalをturn leaseへstageし、Conversation・Trip・base revision・binding・accepted operationの一致を検証する。
4. Trip Applicationはdurable reservationを取得して既存Trip mutation receipt/CASで`Trip.request`を更新する。
5. Trip commit後に、採用したfact/tombstoneだけをoverlayから消費し、無関係な条件を保持する。
6. Trip保存とWorking State完了後だけ、公開receiptと「今回の相談条件（反映済み）」を返す。

Trip commit前の失敗ではreservationを解放する。Trip commit後に応答またはWorking State完了だけが失われた場合は、
同じmutation IDの再送でTrip receiptをread-backし、状態完了だけを冪等に再開する。Tripを巻き戻したり、
モデルを根拠に別mutationへ置き換えたりしない。別turnは未完了reservationが解消するまで更新できない。

同じturnで出発地と行き先など複数の独立条件を受理した場合、Proposal bindingは複数receiptを参照できる。
採用完了も最終receiptだけでなく、binding revisionまでの保存済みreceiptを横断して対象操作を検証・消費する。

## 部分条件とProfile

Trip Requirementへ完全には投影できない明示値は`Trip.request.partialConditions`へ保存する。

- 合計人数だけ: 同行者内訳を補わない。
- 通貨または対象が不明な予算: JPY、総額、1人当たり等を補わない。
- 終了日だけ: 開始日や泊数を補わない。

明示撤回では同じslotのconstraint/partial conditionを削除する。Profileの普段の出発地を今回だけ未定へ戻した場合は、
Profile自体を変更せず`Trip.request.profileSuppressions`へoriginの継承抑止を保存する。複数属性を持つ興味や移動条件は、
target単位で粗く一括抑止しない。

手動Trip編集はsemantic provenanceを引き継がない。次回相談は最新Tripをbaseとして読み、消費済みの古いoverlayを
再適用しない。Conversation/Trip/ownerの境界を越えてreceiptや条件をreplayしない。

## 表示と検証

条件パネルはTrip Requirementとpartial conditionを区別して表示し、未確定値へ架空の単位・内訳・日付を付けない。
認証済み`/api/agent-stream`から、条件受理、Trip保存、公開receipt、再読込、訂正、同一turn replayまでを検証する。
Repository境界では、同一再送、異なる訂正、撤回、複数条件、owner/turn分離、Trip commit後の応答喪失を検証する。

合成モデルの固定応答は保存契約の決定論的検証に使う。実Bedrock確認はTool反復や会話品質を別に測り、
合成結果だけを根拠に実モデルや外部Providerの品質を完了扱いしない。

## 対象外

Trip分岐と仮から確定への遷移は#754、目的別旅行Toolは#755、旅程項目の追加・変更・削除は#756、
実モデルと画面E2Eの総合評価は#758で扱う。旧Conversation draft、旧Profile、legacy migrationは復活させない。
