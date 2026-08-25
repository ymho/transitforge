# ADR 0030: 読み取り専用Domain ToolをMCP Adapterから公開する

## 状態

採用

## 背景

Raiquoraの鉄道能力を外部Agentから利用できるようにする際 MCP Server側へ経路検索や
遅延分析を再実装すると 内部Agentと結果や入力検証が分岐する。MCPは能力の正本ではなく
安定したDomain Serviceを外部プロトコルへ変換するAdapterである必要がある。

Viewer Actionは同じAgent実行で検証されたEntityへ限定する安全境界を持つため
汎用の外部Agentへ公開する能力とは分離する。

## 決定

内部AgentとMCP Adapterは`createReadonlyTransitToolRegistry`で組み立てた同じ
Domain ToolとDomain Serviceを利用する。MCPで公開するToolは次の5つへ固定する。

- `search_journeys`
- `inspect_train`
- `inspect_station`
- `analyze_delay`
- `analyze_congestion`

MCPの入力Schemaは既存Tool ContractのJSON SchemaからZod Schemaへ変換する。
MCP境界の検証後もRegistryが各Toolの`parseInput`を実行し Domain固有制約を検証する。
各Toolには読み取り専用 非破壊 冪等 closed-worldのannotationを付ける。

stdio transportはRegistryを注入するfactoryだけを提供する。データ取得方法 認証
remote transportとデプロイはこの判断へ含めず Composition Rootで構成する。

## 結果

- 内部AgentとMCPで鉄道ロジックと入力検証を重複実装しない
- Viewer Action 経路詳細 外部書き込みはMCPへ公開されない
- Tool追加時にallowlistとProtocol testの明示更新が必要になる
- MCP SDKとZodへの依存はInfrastructure Adapter内へ閉じる

## 検証

- MCP `tools/list`が5つの読み取り専用Toolだけを返すこと
- MCP経由とRegistry直接実行の駅照会結果が一致すること
- 余分なfieldと範囲外の値をMCP境界で拒否すること
- 必須ToolがRegistryにない場合は起動時に失敗すること
