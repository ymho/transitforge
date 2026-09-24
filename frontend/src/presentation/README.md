# Presentation

ブラウザへ表示するView DOM操作 CSS Three.js描画を画面機能ごとに所有する

- `concierge`: 会話 プロフィール 経路候補
- `trip-plan`: 旅程表示と編集提案
- `train-viewer`: 列車操作 詳細 時刻表とThree.js描画
- `shared`: 複数画面が同じ契約で使う状態を持たないView primitive
- `styles`: Viewer shellと共通token CSS entrypoint

外部データはComposition RootからPortまたは値として受け取り HTTPやLocalStorageの
具体実装を直接生成しない `shared`には画面固有の語彙や状態を追加しない

## Product Design System

`shared/primitives.ts` と `shared/primitives.css` を Product UI の共通契約とする。
画面固有CSSで同じ役割のボタン、入力、見出し、surface、iconを再実装しない。

- `ds-page-heading` / `pageHeadingMarkup`: ページ見出し
- `ds-button`: action。primary は `ds-button--primary`
- `ds-control`: `input` / `textarea` / `select`（入力文字は常に16px）
- `ds-composer`: 相談入力
- `ds-surface`, `ds-media-frame`, `ds-empty-state`: content surface
- `iconMarkup`: 固定SVG icon。Unicode文字をナビゲーションiconに使わない

feature固有componentはこれらを組み合わせ、色・文字・間隔は `styles/tokens.css` の
`--product-*` tokenを参照する。Product UIではgradient、serif、強いshadowを使わない。
