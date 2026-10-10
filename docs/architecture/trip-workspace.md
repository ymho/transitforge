# Trip workspace（Current）

保存済み旅程は専用の一覧から開き、日別タイムライン / 日時未定の予定として表示する。
予定を閉じた状態はタイトル・時刻・相談操作を中心に表示し、確定／未確定／要再確認は相談の左のラベルとする。場所・宿泊区分・費用・確認事項・経路詳細は展開内にまとめる。予定内の順序／日付変更欄は撤去し、専用の並べ替え画面に集約する。
未採用の旅程案・検索候補の表示と採用は相談チャットへ集約する。旅程画面には「未採用の提案があります」と「相談で確認」だけを表示し、採用済み予定と候補を混在させない。提案の受信で旅程画面へ自動遷移しない。
相談は同じTripを参照する別の画面。今回の条件の「編集」「削除」は条件の内容の下に、枠なしの小さな文字で横並びに表示する。指定元のラベルは表示せず、条件名と内容を優先する。削除の対象はアクセシブル名で示し、編集画面の「保存」で直接Serverへ反映し、削除・仮定の承認と拒否も相談画面のまま保存する。別の変更案確認コーナーへ移動しない。保存中は二重操作を防ぎ、失敗時は入力と理由を残す。共通ナビゲーションは相談 / 旅程 / 運行 / 設定。
条件編集欄には編集手順や採用済み予定との関係を説明する常設の注意書きを表示しない。閲覧専用の案内は維持する。
旧DesktopのTrip / Chat / Map常設並列配置を現行UIとして扱わない。

`TripWorkspaceSource`はApplicationへのread / preview / confirm接続口で、別のRepositoryではない。
本番はServer sourceを使い、loading / unavailableでも旧writerへ戻らない。編集はProposal → 確認 → Server CAS → 再取得。
候補は採用済みitemsと分離し、候補ID・対象item・期限・Evidence・保持許諾をApplicationで検証する。

- transport / stay / activity、日付・window・fixed・未定、相対日とcalendar bindingを同じTripから投影する。
- 選択済み鉄道は全legs / 乗換間隔と、保持済み種別・列車名・行先を表示する。欠損は推測せず任意時刻編集を拒否する。
- 選択済み鉄道の経路詳細に「e5489で予約」を表示する。最初の乗車駅・最後の降車駅・計画出発日時（日本時間の暦日）からBrowser内でURLを生成し、新規タブで直接開く。列車・乗換区間・人数は指定せず、予約可否・同一経路の検索結果を保証しない。`no-referrer` / `noreferrer`で遷移元を送らず、生成・クリックの専用APIやログは追加しない。e5489側のアクセスログは制御できない。予約・購入状態やTripは更新しない。大阪→福井の日時のみのURLは利用者の実画面で確認済みで、他区間は未確認。
- stayは日別にチェックイン / 連泊 / チェックアウトを投影する。plannedTimingは利用者の予定で、施設受付時間・空室・予約ではない。
- 日付タブは保存済みの現地暦日ごとに一つにまとめる。zone既知／未取得やlogical dayが混在しても同じ日を別タブにせず、同一日内はTrip.itemsの順序を保つ。操作は各entryの元のDomain dayへ戻し、zone・未定時刻・保存済み経路を変更しない。
- 人数はTripRequest.partyを参照する。Profileから補完しない。participants等の参照がある場合の変更は既存保護を通す。
- 概算費用は各予定に表示し、鉄道を除いて入力できる。準備 / 次に決めること / 確認ポイントの集約パネルは撤去し、成立性評価・予約保護・adoption / CASは保持する。
- 単一transport候補はpublic sourceRef / Journey ID等が一意に一致する場合だけ検索カードへ採用操作を統合する。
- 宿泊だけの採用候補もsourceRefと公開hotel evidenceIdが一意に一致する場合、比較カードへ採用操作を統合する。複合案・未束縛の案は分離する。
- 経路・宿の検索は本文を1〜2文の案内・選ぶ理由に絞り、候補名・時刻・乗換・料金・評価の列挙はパネルへ集約する。
- 経路・宿のパネルを描画する回答は、画面の主本文を実際の候補件数に基づく短い案内へ置き換える。モデルの追加説明は閉じた「比較の補足」から必要時に参照し、live・履歴とも詳細を二重に並べない。パネルがない通常の回答は本文をそのまま表示する。
- タイムラインの各日の先頭・予定間・末尾に「＋ 予定を追加」を置く。日・前後の予定（宿泊のチェックイン/アウトを含む）は押した位置から引き継ぎ、日付・種類を入力させない。フォームは自由記述「どんな予定を追加したい？」のみで、場所も相談内容へ含める。「相談して追加」でモーダルを閉じ、希望・挿入位置を相談へ渡す。空の旅程は日時未定として相談する。旧「この後に追加」メニューと手入力の追加案確認は撤去。別Trip/更新後の古いフォームからは相談を開始しない。

一次根拠: `frontend/src/presentation/trip-plan/trip-workspace.ts`、`trip-route-timeline.ts`、
`trip-timeline-interaction.test.ts`、`frontend/src/presentation/home/ai-first-shell.ts`、
`frontend/src/usecases/trip-plan/server-trip-workspace-source.ts`と隣接test。
[最新UI差分](product-timeline-design.md)、[Server保存](trip-server-persistence.md)、[候補選択](agent-v2-candidate-selection.md)を参照する。

## 開発確認

予定ごとの注意事項は重複を除いて、見出し「確認」の黄色い折りたたみ欄へコンパクトにまとめる。注意事項は確認先を明示し、末尾に確認後の操作を案内する。当たり前の否定や保証の説明は載せない。予約記録の取得状態やServerの保存手順は通常表示せず、実際の予約記録と変更時の同意は維持する。相談はカード上の主操作「相談」とし、詳細は下向き／上向きの山形アイコンだけで開閉状態を示し、読み上げラベルとaria-expandedを保持する控えめな操作にする。編集は閉じた操作欄へまとめ、候補がない場合は候補欄を出さない。変更確認は変わった項目だけを比較し、内部の計画状態や行程番号を表示しない。

旅程の「並べ替え」は専用ダイアログを開く。ドラッグまたは上下ボタンで順序を編集し、変更を確認して既存Proposal / CASで保存する。日ごとに予定を表示し、移動以外の予定をドラッグ・上下操作・移動先の日の選択で並べ替える。明示的に動かした予定だけ時刻を消して移動先の日付／論理日を設定し、動いていない予定の時刻は保持する。変更確認前に時刻の再設定が必要な旨を表示する。移動予定は固定し、採用済み宿の宿泊日変更は宿の選び直しへ委ねる。同じ日の宿の順序変更では宿泊日を保持しplannedTimingだけを消す。宿泊の複数日表示は一つの予定として扱う。別Trip・session・revisionへ切り替わった古いダイアログの変更は拒否する。変更がない場合は確認できない。

e5489へのリンクは指定の公式ロゴ（`https://www.jr-odekake.net/assets/img/logo_e5489.svg`）を画像として表示し、読み上げ用ラベルを持つ。画像取得も`no-referrer`とする。

```bash
npm run dev
```

| DEV URL | 現存する実装 / 確認範囲 |
| --- | --- |
| `http://localhost:5173/?trip-workspace-preview=1` | `frontend/src/dev/trip-workspace-preview.ts`。多都市・時刻精度・仮定・参考EUR価格・未定予定の合成Trip。確認操作はメモリ内だけ |
| `http://localhost:5173/?home-preview=data` | `frontend/src/dev/home-preview.ts`。合成Trip sourceをattachする。Home自体はHeroで、一覧は通常Server list sourceを使う |
| `http://localhost:5173/?home-preview=loading` / `?home-preview=error` / `?home-preview=empty` | 一覧sourceの表示stateを置き換える。実APIの成功・認証・保存の証明ではない |
| `http://localhost:5173/?weather-preview=mixed` | `frontend/src/dev/weather-grid-preview.ts`。地図天気の固定データ。地図表示には認証とMapbox設定・Viewer入力が必要 |

flagの接続口は`frontend/src/composition/viewer-composition.ts`のDEV分岐。
通常の画面認証は迂回しない。Backend / Bedrockの実データを使わない合成sourceでも、ログイン済み画面か
`tools/verify_viewer_startup.mjs`の合成認証・APIによるブラウザ確認を使う。API不要を認証不要と読み替えない。
公開auth設定の取得は[dev環境](../../infra/terraform/environments/dev/README.md)を参照する。
合成fixtureは実運行・空室・予報・予約でも本番保存先でもない。撤去済みのlegacy previewは現行操作に含めない。

## 経路全体の選び直し

選択済みの移動予定は「経路全体を選び直す」から同じ予定IDを相談対象にして再検索する。
再検索・比較・採用プレビューでは保存済みの経路をリセットしない。採用を確認した時だけ、
その予定の経路・乗換・日時を新しい候補全体で置き換える。変更をやめた場合は元の経路が残る。
一般の旅程相談からの再検索でも、検証済み候補と選択済み経路の始点・終点・日付が一意に一致すれば
その経路項目を置き換え対象にする。同じ日の未選択の別移動枠より優先し、複数一致は対象を決め直す。
選択済み経路があり始点・終点が一致しない検索は、追加・別区間・一部分の検索の区別を日付だけで推測せず、
画面で相談対象を指定してから採用候補を保持する。

## Historical: #390 / #392 / #398 / #402のworkspace導入

> 以下は導入時点の実装範囲・検証記録。2026-10-05のmain `32d51f6`で履歴として分離した。
> 当時の未有効gate・旧型・旧パス・コマンド・後続予定は現行手順ではない。現在の契約は上のCurrent節を参照する。

#805で旅程一覧→日別タイムラインへ刷新した。[表示・操作・モデル差分](product-timeline-design.md)を参照。概算費用は各予定へ移し、集約パネルは撤去した。

#392で[次に決めることと独立した準備リスト](trip-readiness.md)を追加した。
Planning/Bookingは派生表示、準備のみ別resourceへ保存する。公開writerは引き続きOFF。

#402で[Trip全体の成立性表示](trip-feasibility.md)を追加した。成立/不成立/未確認と該当itemの理由を表示し、
ready変更案は変更後の評価で確認を制限する。未知を成立と見なさず、保存済みplanningStateは自動変更しない。

#398で[独立した予約記録のread表示と変更確認](trip-reservation.md)を追加した。
通常カードは5状態だけを表示し予約番号を出さない。公開writerはOFF、DEV previewは合成データである。

親方針は#382/#415、契約は[ADR 0052](../decisions/0052-establish-trip-v2-contract-and-migration.md)と
[Tripライフサイクル](trip-lifecycle.md)。Trip/Request/候補/Evidenceの別モデルは追加しない。

## Before / Afterと所有境界

| 責務 | 従来 | #390 |
| --- | --- | --- |
| legacyの読込・保存・宿選択 | `trip-plan-panel.ts`がLocalStorageと旧Patchを操作 | 互換経路として維持。V2 sourceが有効な画面では旧表示・旧書込へフォールバックしない |
| 採用済みTrip | V2のpure previewはあるが独立した画面なし | `trip-workspace.ts`が同じ`Trip.items`を読む。型別表示は既存preview helperを再利用 |
| 変更案 | 会話内の提案文 / legacy apply | `trip-workspace-proposal.ts`がDomainで検証したBefore/Afterを表示。現在Tripを置き換えない |
| 一時操作状態 | ContextWorkspaceの地図/旧パネル切替 | session別focus/proposalは`trip-workspace-controller.ts`、scroll/collapse/view/focus DOMはpresentation。Tripへ保存しない |
| 採用操作 | legacy候補を旧planへ挿入 | candidate ID → 既存`proposeCandidateSelection` → verified snapshot → typed Proposal → preview |

`TripWorkspaceSource`はRepositoryではなく既存Applicationのread/preview接続口である。
`getCurrentTrip`は正本の参照を返し、Controllerは別のTripコピーを正本として保持しない。
候補とassessmentは`getCandidates`、trusted resolverは既存`CandidateSelectionPort`へ委譲する。
Provider matching/rankingやTool選択をUIで実装しない。

### Source gate

#388で[server source基盤](trip-server-persistence.md)を追加した。以下は#390導入時の説明であり、
現在はsource所有権を取得成功と分離する。server-v2のloading/unavailableでもlegacy writerを止め、
retry可能な画面を出す。server sourceはread/preview専用でconfirmProposalを持たず、公開CRUD/writerは未有効。

- V2 sourceなし: 従来のlegacy session reader/writer/UIをそのまま使う。
- V2 Tripあり: V2 workspaceとAgent Contextを使い、legacy panel/share/applyは使わない。
- V2の空Trip、候補だけを持つ空Trip、Proposal付きTripも同じ型で表示する。
- この時点では本番にV2 Repositoryがないため、既存LocalStorageを自動変換してsourceを作らない。
  本番sessionへのsource供給とwriter切替は#388/#389が所有する。開発用の明示sourceだけを追加した。
- V2表示/切替はLocalStorageへTripもfocusも書かない。既存Conversation/UI navigationの保存仕様は変更しない。
- `confirmProposal`を明示供給したhostだけ確認ボタンを表示する。#390の開発hostは既存
  `applyTripProposal`でメモリ上のTripを更新するだけであり、再読み込み後の保持を約束しない。
  Provider候補を確認するhostは既存`confirmCandidateSelection`等で候補を再検証する責務を持つ。
  汎用の永続化/自動承認hostを追加していない。

## 表示

Desktop（72rem以上）は履歴 / Trip / Chat / Mapの領域を並べ、Tripの表示中もChatを隠さない。
Mobileは会話・旅程の短いボタンで切り替え、地図へも移動できる。既存の地図全画面は維持する。
同じinput DOMとsessionを保ち、チャット/Trip scroll、選択item、collapse、Proposalを保持する。
カードはstable IDで再利用し、変更されたitemだけを再描画する。兄弟の名称変更時は並べ替え選択肢だけ更新する。

- Transport: 全modeのselected/unresolvedを区別し、railは採用時scheduled値のみ表示する。
  非rail手入力は便/経路未検証であり、実在の便や予約と断定しない。
- Stay: selected/unselected、Placeのname/area/address、check-in/out、許諾済み参考価格の
  原通貨・観測時刻を表示する。checkoutはexclusive、複数日でも1枚のspan cardとする。
- Activity: sightseeing/food/experience/free-time、場所なしの自由時間も表示する。
- 日付bucketはZonedInstantの元のlocal dateを使う。ブラウザtimezoneへ変換しない。
  fixed/window/day精度と時差を既存helperで表示し、unscheduledは独立した「日時未定」へ置く。
  日付順にTripを勝手にソートしない。同一日内はitem順を保つ。
- 多都市は`tripPlacesPreview`で採用済み訪問/宿泊地点を導出し、Requestの希望先と混同しない。
- 人数は`tripPartyView`で今回のparty/子どもの年齢不明を表示する。Profile人数を補完しない。
- unconfirmed assumptionは対象itemの日時/場所/採用内容に印を付け、party/constraintも対象を明記する。
  confirmedは通常表示、rejectedは現在の値の根拠にしない。planning/lifecycleは読み取りlabelだけ。

## 候補と変更案

比較候補を採用済みカードとは別sectionへ配置する。`candidateAssessmentView`と#406の検証済みassessmentを使い、
hard不一致/未確認、移動、天気、防災、料金、partial、caveatを文字で表示する。
予報は必ず対象PlaceRef・開始/終了日を明示し、multi-city全体の予報や安全保証へ拡大しない。
欠測を晴れ/安全/0円へ変換しない。異通貨を合計しない。

経路/宿の選択はcandidate IDと対象item IDをApplicationへ渡し、候補scope/期限/Evidence/retentionを既存境界で検証する。
解決中にsession/Tripが変わった結果を別のTripへ表示しない。未採用候補はTripを変えない。
Activityの編集/追加は既存`proposeItineraryItem`/`proposeManualActivity`を使う。
Activityの時間等の調整でplaceを省略した場合、既存の採用PlaceSnapshotを保持する（Providerをmanualへ偽装しない）。
検索結果のActivity採用は既存AgentのID解決Toolを継続利用する。新しいProvider検索画面/候補Repositoryは作らない。

UI直接操作は名称replace、自由時間add、remove、moveを同じTripUpdateProposalへ変換する。
Domain検証に失敗した案は表示せず、現在Tripを変更しない。Proposalのsummary、itemとrequest/planningの
Before/Afterは自然なラベルで表示し、raw JSON diffを表示しない。

### remove / moveの原子的契約

`TripPatch`の同じunionへ2操作だけ追加した。別DSLやplannerは作らない。

- remove: existing IDだけ。constraint/assumption参照が残る場合は最終aggregate validationでreject。
  同じProposalで明示的にRequestを修復すれば許可する。
- move: existing ID、stable IDを維持。afterId省略は先頭、指定はそのitemの後。
  unknown/self afterIdはreject。Patch列のそれまでの結果を参照する。
- 全操作はclone上で順序適用し最終検証する。途中失敗で元Tripや部分結果を返さない。
- 確認前のbase内容変更/確認中の重複クリックはUIで拒否するが、これはrevision/CASの代替ではない。
  本番の認可・競合・mutation冪等性は#388/#389が所有する。

## Chat / Agent

`featureContext.uiFocus = {itemId, item}`を追加した。Runtimeが現在Tripから同じIDを解決し、
既存のallowlist item projectionを使う。削除/別TripのIDは渡さない。候補は`travelCandidates`に分ける。
通常scheduleの24件上限外でも選択itemを参照でき、Context圧縮後もfocusを保持する。
これは永続planning stateでも認可でもない。モデルが意図/変更内容/Toolを選び、Domainが検証する。

「相談する」「この後に追加」「宿候補」は自然言語の意図とfocusを渡すだけ。
発話regex router・固定質問順・Tool割当は追加していない。追加のモデル呼出しもない。
新規に届いたtyped V2 Proposalだけをworkspaceへ提示し、履歴復元では自動適用/再提示しない。

## 開発確認

```sh
npm run dev
# http://localhost:5173/?trip-workspace-preview=1
```

API/Bedrock/Mapbox tokenなしでsyntheticな多都市Trip、仮置き、参考EUR価格、未評価候補、Proposalを確認できる。
地図タイルや実モデル回答のテストではない。fixtureはDEV-onlyで本番成果物/保存先にはならない。
Desktopで並列表示、390px Mobileで会話→旅程→会話、カードの相談、名称変更案、確認前後を確認する。
既存legacy確認は`?trip-preview=1`を別途使う。両flagを併用しない。

## テストとAC自己レビュー

| AC | 確認 |
| --- | --- |
| 全V2 item/精度/多都市/party/参考価格 | workspace projection + DOM test、既存transport/stay/places/party helper test |
| field別assumption、confirmed/rejected | projection test、既存Request validation regression |
| 候補比較（hard/unknown/weather/hazard/currency/partial/target） | workspace-candidates DOM test。空Trip候補表示、元Trip不変 |
| ID解決とProposal、add/replace/remove/move | Controller + Domain + DOM test。未知ID、stale結果、参照修復、原子性 |
| 現在TripとBefore/Afterの共存 | projection/DOM test。明示host以外は確認ボタンなし |
| Desktop/Mobile、入力/scroll/focus/session | DOM test + headless Chromium 1600×1000 / 390×844確認 |
| uiFocus/最新Trip/候補分離/圧縮/非永続 | Runtime Context test + AA Eval |
| legacy互換、writer gate | 既存panel/repository/会話回帰test、V2 sourceなしのDOM test。Storage format/writer変更なし |
| accessibility | native buttons/forms、aria-controls/pressed/expanded、focus-visible、短いaria-live status、色以外の状態文字 |

Smokeは保存済み12 + Ask/Progress 2 + Trip Progress 11、Fullは42 + 7 + 27。
AAは「ここをもう少しゆっくりにしたい」から選択Activityの具体的replaceを出し、場所/他都市item/Request不変を検証する。
既存A〜Zのthresholdは変更しない。scripted IO評価であり実モデル品質の証明ではない。

2026-09-13の既存AWS認証確認は`Your session has expired`。Live未実施、認証方式は変更していない。
既存方式で再認証後のコマンド:

```sh
npm run eval:agent:decision:live -- --suite trip-progress --case AA-focused-item --output-dir /tmp/raiquora-390-live-aa
npm run eval:agent:decision:live -- --suite trip-progress --case J-refinement --output-dir /tmp/raiquora-390-live-refinement
```

server保存・migration・source供給は#388、revision/CAS/冪等性は#389。
全旅程feasibility #402、予約UI #398、共同編集/共有 #399、通知は未実装のまま残す。

## 読み込み表示

旅程詳細の遷移はTrip取得・会話復元・最新Tripの再取得が完了するまで共通スピナーで待機する。途中で履歴の候補を公開しても旧詳細を一瞬表示せず、後から完了した別画面の遷移は上書きしない。読み込み失敗ではスピナーを止め、旅程一覧からの再試行を案内する。初期起動・旅程一覧・相談開始/復元・回答待機・旅程再取得・プロフィール保存にも同じ円形の待機表示を使う。エラーや完了にスピナーを残さず、装飾はaria-hidden、状態はaria-busyで表す。

Homeで未ログイン時に送信した相談は、タブ内の下書きと送信意図をsessionStorageに保持する。ログイン復帰後は送信意図を一度だけ消費して相談開始へ進む。入力が一致しない場合は自動送信せず、単なる下書き・ログインボタンからの認証では送信しない。開始失敗後は入力を保持して手動再試行とする。

相談の条件一覧は設定済みの値だけを表示する。目的・同行者・移動条件が未設定なら行ごと非表示にし、新しい条件は会話から設定する。条件一覧には手動で新規追加する操作を設けず、既存条件の編集・削除だけを提供する。一部だけ分かっている人数・予算・日程は既知の値を表示し、欠けている内訳を推測しない。

### 旅のタイトル再生成

名称編集は旅程詳細ヘッダーの鉛筆アイコンから手入力で行う。既存title patchを表示時のrevisionで保存し、詳細と一覧を更新する。共有の閲覧者には編集操作を表示しない。旅程一覧には名称編集・再生成操作を置かず、カード全体から詳細を開く。ステータスは文字を伴う色付きチップ、操作メニューの入口は開閉時も同じ円形とする。

以下のタイトル生成APIは画面の操作からは呼ばない。

`generate-title` はサーバーに保存された現在のTripをrevision指定で読み、予定の種別・名称だけをBedrockへ渡して32文字以内の日本語タイトルを生成する。初回の相談文・旧タイトル・共有情報・会話履歴は送らない。Web検索や予約サービスのToolは使わない。生成は10秒・120 token・1回に制限する。

生成後は既存のtitle patchを同じrevisionに対して保存する。生成中に予定や名称が変わった場合はCAS競合で保存を止め、古い予定に基づくタイトルで上書きしない。失敗時は元のタイトルを保持する。Tripの正本だけを更新するため、共有先も次回の取得時に同じタイトルを表示する。既に発行した公式しおりの公開snapshotは再公開まで更新しない。

Trip API Lambdaは`TRIP_TITLE_MODEL_ID`で既存の相談モデルを利用し、既存の許可モデル群に限定して`bedrock:InvokeModel`を付与する。追加Providerや検索用APIキーは不要。

旅程一覧の操作メニューは入口の「…」と内容を分離し、メニュー内に「…」を繰り返さない。名称編集・削除は12px、旅程タイトルは16pxで表示する。
旅程カードの展開アイコンはタイトルの前に置き、相談を小さい塗りボタンで強調する。交通のタイトルに保存された候補番号の接頭辞（`経路1:`など）は表示時に外す。候補選択のID・保存タイトルは変更しない。

予定カードの相談操作は、対象のitemIdをuiFocusに設定し、チャット本文にも旅程名・予定名・旅程内の順番・表示中の日付（設定済みの場合）を添える。同名の予定や日をまたぐ予定でも対象を区別できるようにし、天気・宿候補・経路選び直しにも同じ対象情報を渡す。
未選択の移動には空の経路展開欄を出さず、「手入力」の下で交通手段・出発地・到着地をコンパクトに入力する。交通手段の表示名は共通の日本語ラベルを使う。狭い画面では交通手段を一段目、出発地・到着地を二段目へ配置する。

予定カードは追加操作の前後の間隔を揃え、タイトル行と横のアイコンを揃える。確定済み予定の相談は非表示とし、展開内から下書きへ戻せる。編集の追加折りたたみは撤去し、名称変更はタイトル直後のペン操作へ移す。宿候補を相談は共通の相談へ集約する。削除は確認ダイアログから既存の検証・予約保護・CASを通して直接保存し、別の変更案コーナーは表示しない。

## アプリ内の確認ポップアップ

確定・取消・削除・公式公開・編集中の内容の破棄は共通のアプリ内dialogを使う。名称入力も同じポップアップを使い、Browserのconfirm / promptは呼ばない。取消・Escapeでは変更せず、閉じた後は元の操作へフォーカスを戻す。破棄確認を待つ画面移動は非同期で、承認後だけ移動する。
再読み込み・タブを閉じる際のBrowser標準警告は表示しない。このタイミングでアプリ内dialogは表示できないため、未保存入力の破棄確認はアプリ内の移動時に行う。

