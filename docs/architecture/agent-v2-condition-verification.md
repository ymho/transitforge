# 小さい条件Toolの実装と検証記録

関連: #716 / #724。2026-09-26。
基準main: `8c877569d8b057d26a4b62a85e0bdbe1af10614d`（#725/#726反映済み）。
最終実モデル反復のsource: `51e3278ac0cff0ae56eb49fb614bbbae4bbd37ad`。
GitHub Actions run: 36272420105。Nova 2 LiteをV2の基準モデルとして、条件試験とproduction-shaped Conversationを各3回独立実行した。

## 実装

Strands標準tool()/sequential executor/structuredOutput、Zodの単一schema、既存AWS SDKのDynamoDB transaction/CASを使用。新しいAgent frameworkはない。

V2の旧意味解析レポート入力、旧decoderへの依存、1 invoke全体で1試行しか許さない制限、二重のcapabilities一覧を削除した。Contextの古い一覧はApplication-localな更新Toolを含まず「mutationTools: []」を送っていた。実Tool定義を唯一の能力情報にした。

新しく実装した業務責務は、1条件の最終意思決定を識別する受理操作、durable receipt journal、partial failure/retry、古いturnのfencingである。旧receiptは互換読出しを残し、モデルに生のrevisionや保存IDを作らせない。

## 決定論的検証

- backend typecheck、V2 Acceptance 23ファイル173テスト成功。
- 独立した2更新を同一モデル応答にまとめたSDK試験: 2更新 → 1read → 最終出力、3 model calls。Tool数とmodel call数を混同しない。
- 再送、異payload競合、CAS競合、応答喪失、部分成功、削除/owner/古いturn、旧receipt移行境界を追加検証。
- 条件がProfileより優先され、Profile自体を変更せず、撤回した既定値を復活させないことも検証。
- 作業環境で全体npm test成功。PRの最終headのCI結果はPR本文/コメントに記録する。

## 実Bedrock: Nova 2 Lite

モデル `jp.amazon.nova-2-lite-v1:0`。

7turnの最小条件試験を新しいtest repositoryで独立3回実行。3/3 PASS（21turn）。挨拶、行き先設定、訂正、出発地＋行き先、仮定の比較、行き先だけ撤回、礼を含む。各回16 model calls / 5 external reads / 5 accepted condition operations。別地点を同じsubjectと誤って扱っていた先行fixtureを修正した後の結果で、Applicationの衝突検証は弱めていない。

4turnのproduction-shaped Conversation試験も独立3回実行し、3/3 PASS（12turn）。各回で挨拶は更新なし、初回行き先はintentRevision 1、訂正後は2、各旅行相談で1 read / 1 card、未対応保存はreadなしで完了した。B commit、同じturnのreplay、8件の履歴、訂正後カードも全反復で成立した。

最終live gateは条件試験3/3・Conversation試験3/3で成功した。固定Provider/fixture stateでの結果であり、実Provider・実ブラウザの成功とは区別する。

## 実Bedrock: Nova Lite

`amazon.nova-lite-v1:0`では、同じ条件Toolの複数更新漏れや不要な更新試行、期待した旅行readに到達しないケースを観測した。#726 / ADR 0098でV2の基準モデルは`jp.amazon.nova-2-lite-v1:0`へ変更済みで、Nova Lite固有の失敗はV2のmerge blockerとせず、比較記録として残す。

## 対象外と次の切り分け

実Provider、実ブラウザ、実DynamoDBの状態移行は未検証。使用した保存先はfixtureであり、ユーザーのTrip/Profile/Conversationへ書いていない。

次は本変更をmainへ反映後、実Provider・実ブラウザで行き先設定/訂正/複数条件を確認する。次の条件型は人数・同行者構成で、同じ操作単位の受理基盤を再利用する。地域別・語尾別の分岐、追加model callによるrepair、強制ToolChoiceは追加しない。

作業用のbranch限定workflow/変換scriptは最終差分から削除する。再実行は既存手動Strands v2 Liveの `condition-operations` / `conversation-output` から行う。どれか1回の失敗を反復成功で隠さず最終exitを失敗にする。

プロフィール縮小は#725へ分け、条件Toolの実モデルgateが未達でも独立して検証・反映できるようにした。
