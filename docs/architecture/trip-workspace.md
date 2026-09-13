# Trip V2 workspace（#390）

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
