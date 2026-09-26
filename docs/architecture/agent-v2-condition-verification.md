# 小さい条件Toolの実装と検証記録

関連: #716 / #724。2026-09-26。
基準main: `8d15f42382910f7b312163fc010a451fca790a48`。
実モデル反復のsource: `36584026e78351cdfdb2083789fd34e9156150a6`。
GitHub Actions run: 36269860088。job: Nova 2 Lite 108481703899、Nova Lite 108481703930。

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

4turnのproduction-shaped Conversation試験も独立3回実行。2/3 PASS。全12turnの条件受理revision、回答完了、訂正後のカード、未対応保存、B保存/履歴/replayは成立したが、2回目の初回「出雲大社にいきたい」で期待した場所Provider readが0回だったためFAIL。失敗assertionは残している。

これは最小条件Toolの改善を支持するが、旅行相談全体を安定したと認定する結果ではない。通常CIと独立した総合gateはFAIL。

## 実Bedrock: Nova Lite

`amazon.nova-lite-v1:0`には、同じ条件Toolの複数更新漏れや不要な更新試行、期待した旅行readに到達しないケースが残る。比較対象から除外しない。production model設定は今回変更していない。

## 対象外と次の切り分け

実Provider、実ブラウザ、実DynamoDBの状態移行は未検証。使用した保存先はfixtureであり、ユーザーのTrip/Profile/Conversationへ書いていない。

次は実モデルのTool選択とTool提供内容を読み取り専用のSDK hooksで照合し、必要な旅行readへ進まない理由を調べる。地域別・語尾別の分岐、追加model callによるrepair、強制ToolChoiceは追加しない。必要なreadを選べない場合のモデル適性判断と、正本の永続化保証を分ける。

作業用のbranch限定workflow/変換scriptは最終差分から削除する。再実行は既存手動Strands v2 Liveの `condition-operations` / `conversation-output` から行う。どれか1回の失敗を反復成功で隠さず最終exitを失敗にする。

プロフィール縮小は#725へ分け、条件Toolの実モデルgateが未達でも独立して検証・反映できるようにした。
