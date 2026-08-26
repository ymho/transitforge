# ADR 0034: Viewer UIをFeature単位で配置する

- ステータス: Superseded by ADR 0037
- 日付: 2026-08-25

## 背景

会話 旅程 列車選択のUIが`src/presentation`へ並び 状態の所有者と変更時に参照する範囲が分かりにくかった
一部のPanelはHTTPやLocalStorageやMapbox Three.jsの具体実装も直接参照していた

## 決定

- 会話とプロフィールは`features/concierge/presentation`へ置く
- 旅程は`features/trip-plan/presentation`へ置く
- 列車選択と運行表示は`features/train-viewer/presentation`へ置く
- 複数Featureで共有する状態を持たないUI部品だけを`src/presentation`へ残す
- FeatureのViewへStorage 通信 描画の実装を注入する
- FeatureはAdapterとRenderingの具体型をimportしない
- `main.ts`をComposition Rootとして実装を接続する

## 結果

機能変更時に参照するディレクトリが明確になる
Viewはテスト時にStorage 通信 描画を差し替えられる
Feature間で共有すべきUIだけがルートのPresentationへ残る

Featureが外部実装を必要とする場合はPortを先に定義する必要がある
UIファイルの物理移動だけを目的にせず 状態と副作用の所有者も同時に確認する

Frontend workspace内の`presentation`へ再配置する後続判断は
[ADR 0037](0037-adopt-typescript-workspaces-and-shared-domain-modules.md)を正本とする。
