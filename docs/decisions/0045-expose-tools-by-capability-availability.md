# ADR 0045: Tool公開を業務ケースではなく能力の利用可能性で決める

- ステータス: Accepted
- 日付: 2026-08-30
- 関連: ADR 0021 0023 0026 0031 0038 0044

## 背景

Viewer Adapterは旅行相談を事前分類し ケースごとに`allowedToolNames`を組み立てていた。
さらにモデルが文章を返した後に`finalResponsePolicy`が固定順序のTool実行を要求し
`ask_follow_up` Adapterも写真 Web検索 ページ読解 POI照合の順序を検査していた。

この構成ではBedrockがContextとTool結果を読む前に選択肢を狭め Applicationが別の
自然言語ルールエンジンとして調査順序を決める。新しい相談パターンのたびにif文が増え
既知条件の聞き直しや実行上限到達の原因にもなる。

## 決定

ViewerがBedrockへ公開するToolは次の決定論的条件だけで絞る。

- 対応AdapterまたはDomain Serviceが構成されている
- 現在旅程を変更するToolには現在旅程がある
- 記憶 更新 予定保存などのside effect用Portが構成されている

旅行ケース intent 調査順序を理由にToolを隠さない。適する場面 適さない場面 前提 Evidence
鮮度 制約はTool descriptorでモデルへ伝える。Viewer Adapterの業務フロー用
`finalResponsePolicy`と`ask_follow_up`の固定調査順序検査を削除する。

モデルが選んだToolの入力は従来どおりparserとAdapterで検証する。Evidence Claim
Viewer Action timeout model call Tool call iterationの上限は変更しない。Tool結果を受けた
再計画を維持し Reflection専用のmodel callは追加しない。

## 影響

### 良い影響

- Bedrockが同じ能力集合から目的に合うToolと追加質問を選べる
- 新しい会話表現をViewer Adapterの正規表現へ追加せずに扱える
- 利用できない外部Providerをモデルへ提示しない
- Tool選択の責任と実行安全性の責任を分離できる

### リスク

- descriptorが不十分だと不要なToolを選ぶ可能性がある
- 公開Tool数が増えるため入力tokenが増える場合がある
- 実モデルのTool選択品質はoffline fixtureだけでは保証できない

Smoke Full Evalと旅行会話回帰で既知条件 Tool順 完了状態を継続確認する。実モデルの
latency token model call Tool callはTraceで比較し 品質低下時はケース別allowlistを戻さず
descriptor ContextまたはBenchmarkを改善する。

## 確認

- `npm test`
- `npm run build`
- `npm run architecture:check`
- `npm run workspace:check`
- `npm run eval:agent:smoke`
- `npm run eval:agent:full`

