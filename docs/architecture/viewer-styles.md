# Viewerスタイル

## 所有範囲

`frontend/src/presentation/styles/viewer.css`を唯一の入口とし import順を明示する
featureの所有CSSを順に読み込む。#453では旧`application-shell.css`を廃止し、
`presentation/home/product-shell.css`が4ナビ・primary route・地図subviewの配置を所有する。
Trip Workspaceや会話・地図の内部componentは既存所有featureに残す。

| パス | 責務 |
| --- | --- |
| `presentation/styles/map-layout.css` | 地図とHUDの基礎配置 |
| `presentation/home/product-shell.css` | Home/4ナビ/不透明な製品面/primary routeと二次導線の配置 |
| `presentation/styles/tokens.css` | day night共通の色 影 ぼかし Focus |
| `presentation/styles/liquid-glass-foundation.css` | 時計と地図操作のLiquid Glass基盤 |
| `presentation/styles/legacy-*.css` | 複数Featureへまたがる移行中のtokenと上書き |
| `presentation/concierge/*.css` | 会話 プロフィール 経路候補 |
| `presentation/trip-plan/*.css` | 旅程PanelとCard |
| `presentation/place-explorer/*.css` | 地図上の観光候補CardとLiquid Glass Panel |
| `presentation/train-viewer/*.css` | 列車詳細と時刻表 |
| `presentation/shared/loading-screen*.css` | 起動中と失敗時の表示 |

共通Presentationは2つ以上のFeatureが同じ契約で使う 状態を持たないprimitiveに限定する
画面の語彙 状態 DOM classを持つViewとCSSは対象機能の`presentation/<feature>`へ置く

新しいComponentのselectorを`styles/legacy-*.css`へ追加しない
変更するFeatureのCSSへ置き 共通値は`tokens.css`へ追加する
import順による上書きが必要な場合は`viewer.css`ではなく所有するCSS内で隣接させ 理由をコメントする

旧`compatibility-ui.css`は行順を維持したまま所有Featureへ分割した
`legacy-responsive-overrides.css`と`legacy-theme-overrides.css`に残る交差指定は
各Featureのfinal CSSがday night mobile reduced-motionをすべて所有した時点で削除する
移行ファイルを変更するPRでは対象selectorを所有先へ移せない理由を本文へ記載する

## 表示比較

Place Explorerは詳細取得後に同じcandidate snapshotで詳細と一覧を更新する。
詳細のprovider ID・identity provider・targetBindingを先に検証し、不一致/未解決なら既存candidateを変更しない。
画像なしの更新も旧画像を復活させず反映する。解説・地点同定の出典は写真のiボタンと分ける。
詳細は内容サイズとviewport上限を持ち、地図focusはpanelのscreen offsetを使う（座標は変更しない）。

地図操作内の`hidden`は要素種別に関係なく`display: none !important`で維持する。
再生速度のwrapperが`display: grid`でも、既存`renderDisplayMode`の非表示を上書きしない。
mode stateや操作可否の正本はCSSへ移さない。

APIやBedrockを使わず旅程を確認する場合は
`npm run dev --workspace @raiquora/frontend -- --host 0.0.0.0`で起動し `?trip-preview=1`を付ける
局地天気の表示を確認する場合は`?weather-preview=mixed`を付ける
大阪付近を東西へ約1km動かすごとに晴れ 曇り 雨が切り替わるため BackendなしでMapboxの降雨とFog表現を比較できる

変更前後で次の状態を同じViewportで比較する

| Viewport | モード | 確認する状態 |
| --- | --- | --- |
| 1440 x 900 | day night | 地図 時計 操作Panel 列車詳細 |
| 1440 x 900 | day night | Concierge 経路候補 旅程Panel |
| 390 x 844 | day night | Bottom Sheet 入力欄 日時Picker |
| 390 x 844 | day night | プロフィール初回表示 旅程Card |
| 390 x 844 | day night | 観光候補の横スクロール Cardと地図Pin選択 |

次を確認する

- Panelを開閉して地図操作と重ならない
- 文字とIconのContrastがday nightで維持される
- 横スクロールする宿候補と縦スクロールする旅程が操作できる
- 観光候補はCard選択でPinへ移動し Pin選択で対応Cardが画面内へ移動する
- 会話入力の候補チップは短い選択肢を中央へ並べ 画面幅を超える場合も文字を潰さず横スクロールできる
- Focus Ringと44px相当の操作領域が失われていない
- `prefers-reduced-motion`で不要なAnimationが停止する
- チャットと地点解説のタイプライター中は、未到達のリスト記号や後続のブロックを先に表示しない
- 地点詳細はタップ直後に名前と操作を表示し、追加情報取得中のトーストを操作ボタンへ重ねない。ネットワークが遅い場合は写真・解説の到着まで初期表示を保つ
- サイドバーの地図モード選択は全画面表示に対応し、会話に戻ると通常幅と折りたたみレールのどちらも非選択へ戻る

CSSだけの整理ではDOM classや見た目を変更しない
意図したデザイン変更は別Issueとし 比較画像をPRへ添付する

## AI-first shell (#453)

- Consumer表示では通常cardの角丸20px/controlの角丸12pxを共通tokenとして使う。
  Home heroだけはcardへ閉じ込めずviewport幅・高さを使う写真面とし、headerのロゴとアカウント導線を重ねる。
  Heroを離れてスクロールしたheaderはsolid surfaceへ戻し、ロゴ色も背景に合わせて反転する。
  Home heroは中央の相談入力と、操作できない短い入力例1件だけを表示する。見出し・説明・認証CTA・写真選択UIは重ねない。
  写真を持たないTripには装飾アイコンを使う。Home heroはRaiquora所有の西日本観光写真を背景に使い、
  表示開始時に写真と入力例をそれぞれ1件選ぶ。写真の切替操作や自動再生は設けず、scrimで入力の可読性を保つ。
  `travel-decoration`はaria-hiddenの純粋な装飾で、実景や調査済み地点の証拠ではない。
- 成立性の計算とready判定は変更せず、表示のみ「旅の確認ポイント」等にする。
  未確認/見直し事項は本文に残す。評価日時は日本時間の読みやすい形式で折りたたみ詳細へ置き、
  revisionやISO日時を主画面へ露出しない。計画状態の内部enumもreadiness本文へ表示しない。

- `home-read-model`は#450 `classifyTrips`と#452 CandidateAssessmentのcoverageを利用する読取projection。
- 読取元は現在Conversationが参照する既存Trip Workspace source。一覧API・public writerは有効化しない。
  全server Trip一覧は#454へ残す。未認証/読取不能は空の保存済みTrip一覧と同義にしない。
- Home送信は既存ConversationSessionの新規相談へ渡す。未認証でも入力欄は表示し、内容のある送信時に認証を開始して
  タブ内の下書きを保持する。認証前に相談を開始したり入力を消したりしない。Trip採用/変更は既存Proposal確認だけ。
- 地図はsubview初回表示で起動する。初期の文章相談は同じAgent RuntimeとHTTP Toolを使用し、
  Mapbox token/WebGL/列車描画データを待たない。全画面loadingは地図を明示的に開いた初回だけ表示し、
  Homeや相談の起動状態には使わない。現在地を起点として推定しない。
- URLは「探す・相談・旅程・運行」の主要ナビ、headerのアカウント導線、地図subviewだけを保持し、Trip documentやowner/共有secretは保持しない。
  相談と保存旅程は認証済み利用者だけが開け、未認証のdirect routeはHomeへ戻す。
  入力下書きはタブ内sessionStorage（Home/Conversation ID単位）、読取不能でも操作を妨げない。
- DEV専用`?home-preview=loading|empty|error|unauthenticated|data`で表示状態を再現できる。
  dataは明示サンプルの読取専用Trip/候補を本番共通componentへ渡し、保存・予約・調査済み情報を捏造しない。
  v6と同じブラウザの1440/390px比較は`tools/capture_product_design.mjs`で行う。
  CI / Testのmanual `visual_comparison`入力で比較画像/HTMLをartifact化できる。deployは行わない。
- Profileは#457の既存UserProfile v2 editorへ接続。設定・履歴・通知・列車地図は二次導線。
- Product UIは見出しを含めシステム日本語ゴシックへ統一し、Webフォントの追加配信は行わない。
  地点の証拠として写真を使う場合は検証済みPlaceと出典を維持し、Homeのブランド写真と混同しない。
- モックの固定料金・固定天気・固定旅程・固定残日数はコピーしない。
  費用予測#458、旅程詳細4タブ#459、旅行モード#460、認証#451は未実装として残す。
