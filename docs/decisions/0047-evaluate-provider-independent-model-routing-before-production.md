# ADR 0047: provider非依存のmodel routingを同一Benchmarkで評価してから本番化する

- ステータス: Accepted
- 日付: 2026-08-30
- 関連: ADR 0027 0029 0031 0033 0038 0044 0046

## 背景

単純な照会と 複数ToolのEvidenceを統合する判断では 必要なmodel能力とコストが異なる可能性がある。
しかしApplicationが自然文を分類する巨大intent routerを持つと Bedrockへ移した意思決定を再び
if文へ戻してしまう。特定vendorやmodel IDをUsecase契約へ露出することも避ける必要がある。

## 決定

ApplicationとConversation Model Portは`default` `lightweight` `decision`という
provider非依存のmodel classだけを扱う。model IDの選択と検証はBedrock Adapterに閉じ込める。
class別modelが未設定なら既定modelへフォールバックし 既存の単一model設定を維持する。

Runtimeは明示的に注入されたmodel classを全model callへ渡せるが 利用者の文面をif文で分類しない。
本番Viewerはclassを指定せず 同一modelを使い続ける。class routingの候補は同じAgent Benchmarkで
次を計測して比較する。

- Tool Selection Constraint Grounding Completion Viewer Actionの品質
- total latency input/output token
- model callとtool call

品質を維持し model/tool callを増やさず latencyまたはtokenを10%以上改善した実測結果がある場合だけ
本番routingを別PRで有効化する。fixtureや推測値だけでは有効化しない。Multi-Agentや常時Reflectionは
導入しない。

## 影響

- model変更がAgentのDomain Tool Evidence Viewer Action境界へ漏れない
- Nova以外を含む安全なBedrock基盤model IDを設定できる
- 実測比較なしのコスト最適化で品質を落とすことを防げる
- routing policyの本番導入は後続の実測結果まで保留される

## 確認

- `npm test`
- `npm run build`
- `npm run architecture:check`
- `npm run workspace:check`
- `npm run eval:agent:smoke`
- `npm run eval:agent:full`
- `terraform fmt -check -recursive infra/terraform`
- `terraform validate`と`terraform plan -refresh=false`
