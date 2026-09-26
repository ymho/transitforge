# ADR 0098: Agent v2の基準モデルをNova 2 Liteへ変更する

- ステータス: Accepted
- 日付: 2026-09-26
- 関連: ADR 0096、ADR 0097、#716、#724

## 背景

Agent v2はStrands標準のTool loopとstructured outputへ移行し、条件更新も小さい業務Toolへ分離した。同一のTool/Application契約で実Bedrockを比較した結果、`jp.amazon.nova-2-lite-v1:0`では行き先受理、訂正、旅行read、カード、B commit/history/replayのproduction-shapedな縦断が成立した。一方、旧基準の`amazon.nova-lite-v1:0`では複数条件の取りこぼし、不要な更新Tool再試行、Evidence参照失敗が残った。

旧モデルを通すためのPrompt例外、発話別分岐、repair、強制ToolChoiceを追加すると、V2で減らした独自Agent制御を再び増やすことになる。

## 判断

Agent v2のproduction基準モデルを`jp.amazon.nova-2-lite-v1:0`へ変更する。

- V2の実モデル受入はNova 2 Liteをmerge gateとする。
- Nova Liteは比較・回帰観測には利用できるが、V2機能のmerge blockerにはしない。
- Strands/Tool/Applicationの契約はモデル固有APIへ寄せず、Model IDを差し替え可能なまま維持する。
- Applicationのowner、入力検証、A/B commit、CAS、Evidence/currentness、receipt/replayはモデル性能を理由に緩めない。
- Nova 2 Liteのための独自retry、repair、ToolChoice制御、発話別regexは追加しない。

## 適用範囲

Terraformのdev既定`bedrock_model_id`、production Server Agentのfallback、V2 live evaluatorとproduction-shaped live testの既定をNova 2 Liteへ揃える。旧V1比較用fixtureや過去の評価記録は履歴として書き換えない。

## 検証

通常のV2 Acceptance / Smoke / full CIに加え、Tool選択を変更するV2機能ではNova 2 Liteの有料live laneを別判定で実行する。固定Providerでの成功を実Provider・実ブラウザの成功とは扱わない。

将来より上位または別Providerのモデルへ変更する場合も、同じ受入シナリオを使い、弱いモデル向けの特例を増やすのではなく基準モデルを明示的に変更する。
