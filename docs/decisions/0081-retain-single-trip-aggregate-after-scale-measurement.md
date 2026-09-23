# ADR 0081: 30日・90日測定後も単一Trip aggregateとimmutable receiptを維持する

- ステータス: Accepted
- 日付: 2026-09-23
- 対象: #560（親 #537）

## Context

Trip APIはUTF-8 256 KiB、items/constraints/assumptions各100、深さ32を上限とする。DynamoDBはTrip全体JSONを1 itemへ保存し、各mutationは更新後Tripのimmutable snapshotもreceiptへ保存する。長期旅程で上限を無制限化するとDynamoDB item/transaction制約、Context肥大、retry結果の変質につながる。一方、測定前にTrip root + immutable item chunksへ移行すると、複数page snapshot、root CAS、cleanup、rollbackの新しい整合性問題を導入する。

## Measurement

`npm run eval:epic-537:scale -- --repetitions 30`をNode v24.19.0、Linux x64で2026-09-23に実行した。各反復はDaily projection、Workload、全体Temporal network、Trip encode/decodeを同じ入力で行う。値はローカル比較でありproduction SLOではない。

| fixture | items | payload | p50 | p95 | projection |
|---|---:|---:|---:|---:|---|
| 1日 | 1 | 551 bytes | 0.476 ms | 1.664 ms | 1/1 complete |
| 7日 | 7 | 1,769 bytes | 1.143 ms | 2.399 ms | 7/7 complete |
| 30日 | 30 | 6,566 bytes | 3.861 ms | 6.477 ms | 30/30 complete |
| 90日 | 90 | 19,106 bytes | 14.066 ms | 19.814 ms | 90/90 complete |

追加境界測定:

- 100 itemsは受理、101 itemsは保存前に`payload-too-large`で拒否した。
- 日本語3-byte文字を含む100 items fixtureは261,869 bytesを受理し、次の262,169 bytesを拒否した。
- 90 items Tripへ100回連続mutationを適用し、root revision 100、100個のimmutable receipt、最初のretryがrevision 1の原結果を返すことをSDK contract fakeで確認した。
- 各規模30反復でprojection、workload、constraint network、global feasibility、Context snapshot、production persistence parser round-trip、PublicPlanPresentation parserを別phaseとして測定し、failure rateはすべて0だった。JSON reportにphase別p50/p95を残す。
- 上限近傍snapshotを100回保存するとreceipt本文だけで約26.2 MBとなる。これはTrip item肥大ではないが、DynamoDB保存費・保持量の運用指標にする。
- Heap deltaはGCに左右されるため絶対gateにせずreportへp50/p95を記録する。latencyも回帰比較に用い、環境依存の固定SLOにしない。

## Decision

単一Trip aggregate、root revision CAS、mutationごとのimmutable result receiptを維持する。100 items／256 KiBを明示上限とし、超過時に先頭N件だけを保存しない。read projectionは最大90日pageとrevision-bound continuation/coverageを使い、ContextへTrip全量を投入しない。

Trip root + immutable chunksへの移行は現時点で採用しない。採用を再検討する条件は、実利用の30日旅程が100 itemsまたは256 KiBを恒常的に超える、近傍payloadのreceipt保持費が許容不能、単一item read/write latencyがSLOを継続的に外れる、のいずれかをproduction-shaped測定で確認した場合とする。

version移行はreader対応→pure変換test→writer gateの順を維持する。rollbackは新versionを読めるServer build／feature gateへ戻し、Browser/LocalStorage authority、dual-write、旧schemaへの破壊的書戻しを復活させない。

## Consequences

- 30日は通常機能、90日は100-item上限内のstressとして同じ正本で扱える。
- 90日を超える、または1日複数itemで100件を超える入力はtyped拒否／partial readで扱い、部分Tripとして保存しない。
- mutation receiptの保持量を監視対象にするが、過去retry結果を最新Trip参照へ置換しない。
- chunk migration、別DB、常時非同期化の運用負担を現時点では増やさない。
- Live DynamoDB負荷試験、production rollback rehearsal、実Browser 90日描画はこのoffline測定で代替しない。
