# Viewerスタイル

## 所有範囲

`src/viewer.css`を唯一の入口とし import順を明示する
各ファイルの内容を連結した順序は整理前と同一に保つ

| パス | 責務 |
| --- | --- |
| `styles/map-layout.css` | 地図とHUDの基礎配置 |
| `styles/tokens.css` | day night共通の色 影 ぼかし Focus |
| `styles/liquid-glass-foundation.css` | 時計と地図操作のLiquid Glass基盤 |
| `styles/legacy-*.css` | 複数Featureへまたがる移行中のtokenと上書き |
| `features/concierge/presentation/*.css` | 会話 プロフィール 経路候補 |
| `features/trip-plan/presentation/*.css` | 旅程PanelとCard |
| `features/train-viewer/presentation/*.css` | 列車詳細と時刻表 |
| `presentation/loading-screen*.css` | 起動中と失敗時の表示 |

共通Presentationは2つ以上のFeatureが同じ契約で使う 状態を持たないprimitiveに限定する
Featureの語彙 状態 DOM classを持つViewとCSSは対象Featureの`presentation`へ置く

新しいComponentのselectorを`styles/legacy-*.css`へ追加しない
変更するFeatureのCSSへ置き 共通値は`tokens.css`へ追加する
import順による上書きが必要な場合は`viewer.css`ではなく所有するCSS内で隣接させ 理由をコメントする

旧`compatibility-ui.css`は行順を維持したまま所有Featureへ分割した
`legacy-responsive-overrides.css`と`legacy-theme-overrides.css`に残る交差指定は
各Featureのfinal CSSがday night mobile reduced-motionをすべて所有した時点で削除する
移行ファイルを変更するPRでは対象selectorを所有先へ移せない理由を本文へ記載する

## 表示比較

APIやBedrockを使わず旅程を確認する場合は`npm run dev -- --host 0.0.0.0`で起動し `?trip-preview=1`を付ける

変更前後で次の状態を同じViewportで比較する

| Viewport | モード | 確認する状態 |
| --- | --- | --- |
| 1440 x 900 | day night | 地図 時計 操作Panel 列車詳細 |
| 1440 x 900 | day night | Concierge 経路候補 旅程Panel |
| 390 x 844 | day night | Bottom Sheet 入力欄 日時Picker |
| 390 x 844 | day night | プロフィール初回表示 旅程Card |

次を確認する

- Panelを開閉して地図操作と重ならない
- 文字とIconのContrastがday nightで維持される
- 横スクロールする宿候補と縦スクロールする旅程が操作できる
- Focus Ringと44px相当の操作領域が失われていない
- `prefers-reduced-motion`で不要なAnimationが停止する

CSSだけの整理ではDOM classや見た目を変更しない
意図したデザイン変更は別Issueとし 比較画像をPRへ添付する
