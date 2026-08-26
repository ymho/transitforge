# ADR 0032: Domainが中核契約を所有する

- ステータス: Superseded by ADR 0037
- 日付: 2026-08-25

## 背景

列車 停車駅 経路 運行分析の型が`src/data`にあり Domainが入力LoaderやBedrock応答の型を
参照していた。Mapboxの天気型とbrowser globalの実装もDomainへ置かれ 外部実装の変更が
決定論的な鉄道ロジックへ波及する構成だった。

## 決定

- 列車 経路 駅 運行状態と運行分析の契約を`src/domain`が所有する
- JSON HTTP Bedrock Browser Mapboxとの変換と副作用を`src/adapters`へ置く
- AdapterはDomain契約へ依存できるが DomainからAdapterへ依存しない
- 入力JSON API path AWS resource nameは配置変更を理由に変えない
- Viewer Agentも共通RuntimeからDomain Portを呼び Adapter内へ鉄道計算を追加しない

## 影響

- Domain ServiceをHTTPやMapboxなしで利用できる
- 入力ValidatorとProvider Adapterの配置が利用目的から分かる
- 既存の`src/data` importは新しいDomainまたはAdapter pathへ移行する
- ファイル移動を参照する文書とテストも同じ変更で更新する必要がある

## 確認

- `npm run architecture:check`
- `npm test`
- `npm run build`
- viewer-inputとAgent APIの回帰テスト

TypeScript workspaceと共有Domain moduleへの移行後の配置は
[ADR 0037](0037-adopt-typescript-workspaces-and-shared-domain-modules.md)を正本とする。
