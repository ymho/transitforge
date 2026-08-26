# ADR 0036: Domain Logicを実行境界ごとに一意に所有する

- ステータス: Superseded by ADR 0037
- 日付: 2026-08-25

## 背景

RaiquoraはBrowserのTypeScriptとAgent APIのPythonにまたがる
経路検索 遅延分析 旅行候補などの名前が両側に現れるため 型の共有を実装の共有と誤認すると
同じ判断が別々に実装され 結果の不一致と評価不能を招く

一方で全処理を一方の言語へ移すと Browserの列車表示とprivateデータへ接続するBackendの
実行特性を損ない 移行リスクも大きい

## 判断要因

- 決定論的な計算の正本を一つにする
- privateな時刻表と運行データをBrowserへ配布しない
- AgentがDomain計算を生成または補完しない
- 既存APIとAWSリソース識別子の互換性を維持する
- 段階移行と単独レビューができる

## 選択肢

### 言語を一つに統一する

概念の重複は減るが Browser描画またはBackend処理の大規模な移植が必要になる

### 両言語へ同じDomain Logicを実装する

各実行環境では扱いやすいが 境界テストだけではアルゴリズムのdriftを防げない

### 実行責務ごとに正本を決め versioned contractで接続する

Browser固有の列車表示と端末内状態をTypeScriptが所有し privateデータを使う経路 運行 旅行計算を
Pythonが所有する。TypeScriptのAgent Applicationは計算を呼ぶPortとToolを所有する

## 決定

実行責務ごとにDomain Logicの正本を一つだけ定める

- TypeScriptは列車表示 業務時刻 Viewer状態 端末内の会話と旅程を所有する
- Pythonは日付別経路検索 遅延予測 運行分析 旅行候補計算を所有する
- TypeScriptの`JourneySearchService`はPython実装を呼ぶPortであり検索アルゴリズムを持たない
- Agent RuntimeはTool Evidence Trace Policyを所有し Domainの計算結果を変更しない
- JSON HTTP Bedrock AWS Provider形式はAdapterが所有する
- 言語間はversioned HTTP contractと共有scenarioの適合試験で接続する

重複を許すのはparse serialize 入力検証 表示projectionと境界テストに限定する
所有マトリクスは[Domainの所有権](../architecture/domain-ownership.md)を正本とする

## 影響

### 良い影響

- 経路や遅延の不具合を調べる正本が明確になる
- LLMとViewerが決定論的な事実を独自に補完しなくなる
- PythonとTypeScriptを同時に全面移行せず整理できる
- MCPと内部Agentが同じDomain Serviceを再利用できる

### 悪い影響

- wire contractを両側で検証する必要がある
- Browserだけでは本番相当の経路計算を完結できない
- UI向けの経路 旅行 会話型と表示変換はDomain計算から分離して維持する

### リスク

- PortをDomain実装と誤認してTypeScriptへ計算が追加される可能性がある
- Pythonのファイル移動だけで依存方向が改善したと判断する可能性がある

## 確認

- Architecture checkで禁止された依存方向を検出する
- TypeScriptのHTTP AdapterとPython request contractの双方をテストする
- journey search scenarioを境界適合試験として継続実行する
- Agent EvalでTool選択 制約充足 Grounded Claimを確認する

## 置き換えるADR

なし

BackendをTypeScriptへ統一し共有Domain moduleを正本とする後続判断は
[ADR 0037](0037-adopt-typescript-workspaces-and-shared-domain-modules.md)を参照する。
