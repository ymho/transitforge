# ADR 0021: AgentとDomain Logicの間に共通Tool境界を置く

- ステータス: Accepted
- 日付: 2026-08-25

## 背景

既存の経路検索 遅延 混雑 列車照会は決定論的なドメイン処理として実装されている
一方 コンシェルジュのTool定義 実行 分岐はBedrock形式と同じモジュールに集まり
別のAgent Runtimeや将来のMCP Adapterから再利用しにくい

LLMに鉄道ロジックを再実装させず 推論と正確な計算の境界を固定する必要がある

## 判断要因

- Domain Logicをモデルや通信方式から独立させる
- Tool入力を実行前に検証する
- エラーを評価と再計画に使える構造へする
- Provider AdapterとMCP Adapterで同じToolを再利用する
- 例外へ含まれる秘密情報をモデル向け結果へ流さない

## 選択肢

### BedrockのTool仕様を共通契約にする

既存変更は少ないが モデル固有のメッセージ形式がドメインへ漏れる

### Provider非依存のTool ContractとRegistryを置く

Adapter変換が必要になるが Domain ToolをAgentとMCPで共有できる

## 決定

`src/application/agent/`にProvider非依存のTool ContractとRegistryを置く

- Toolは名前 説明 入力Schema 入力parser 実行関数を持つ
- JSON SchemaはProviderへ能力を提示する記述であり 入力parserを実行時検証の正本とする
- 実行結果は成功と構造化エラーの判別可能なunionで返す
- Registryは未知Tool 不正入力 重複名を拒否する
- 予期しない例外の本文はTool結果へ含めない
- Bedrock ConverseやMCPの型は共通契約へ含めない

既存Domain Logicは後続PRで薄いTool Adapterから呼び出す
このADRでは既存コンシェルジュの実行経路を変更しない

## 影響

### 良い影響

- LLMの推論と鉄道計算の責務をテスト可能な境界で分離できる
- Provider変更やMCP追加で鉄道ロジックを複製せずに済む
- 不正入力と実行失敗をAgent Runtimeが明示的に扱える

### 悪い影響

- ToolごとにSchemaとparserの両方を保守する必要がある
- 既存Toolを段階的にAdapter化する期間は新旧の実行経路が併存する

### リスク

- Schemaとparserが乖離するとモデルが生成できる入力と実行可能な入力がずれる
- 共通契約へ個別ドメインの都合を追加しすぎると境界が再び肥大化する

## 確認

- 正常入力だけがToolへ渡ること
- 不正入力 未知Tool 重複Toolを明示的に拒否できること
- 例外本文がTool結果へ漏れないこと
- 既存コンシェルジュのテストとビルドが変わらず通ること

## 置き換えるADR

なし
