# 旅程・相談・設定の刷新（#805）

最新main（#799 / #807完了）から、合意した旅程一覧・タイムライン・設定の見た目を適用する。
運行状況のMapbox描画は対象外。画面本体の新CSSは`#app[data-primary-view]:not([data-primary-view="map"])`に限定し、共通ナビゲーションとMapbox標準操作部の配色のみテーマへ接続する。

## 入出力差分

| 項目 | 契約と対応 |
| --- | --- |
| 複数旅程 | owner-scoped cursor APIを再利用。一覧の行から選択し、詳細の「旅程一覧」から戻る |
| 日付 |既存schedule / calendar binding / 明示した旅行期間の表示。両端に月、年跨ぎは両端に年 |
| 人数 | 既存request.party。大人・子ども別SVG。残る子どもの年齢・年齢区分・compositionを保持。participantsがある旅程の人数増減は相談へ案内し、参照を削除しない |
| スポット後の追加 | 既存add操作へdayKey/afterIdを渡す。未定の日にも追加。入力面は押した時だけ開く |
| 観光・手入力移動の時刻 | 新しいuser operation `set-planned-time`から既存fixed scheduleへ。日付・タイムゾーンを明示。relativeのlogicalDayIdを保持しbinding矛盾を拒否 |
| 宿の予定時刻 | **モデル追加**: stayのoptional `plannedTiming.checkIn/checkOut: ZonedInstant`。下記参照 |
| 鉄道時刻 | 選択済みprovider区間は任意時刻変更を拒否。既存経路全体再選択を使う |
| 費用・準備 | costsは「費用」に折りたたむ。準備・確認の集約パネルを撤去し、reservation / checklistのモデルと成立性評価は保持 |
| 設定 | 出発地・興味・配慮事項、経路検索、通知、ログアウトを保持。外部サービスの帰属表示も保持 |

## 宿の予定時刻（UI変更とは別のモデル差分）

採用済み宿の`checkInDate/checkOutDate`と日付scheduleは変更しない。施設の受付可能時間・空室・予約確認とは別の利用者の予定である。
`set-stay-planned-time`は既存TripUpdateProposalのreplaceを作る。日付・zone一致、時刻順序、snapshotの余分なキーをDomainで検証する。追加endpointや別storeは作らず、既存preview→確認→revision/CAS保存を利用する。
古いsnapshotの読み出しを維持し、予定時刻がなければ「未定」。日付未定の宿は先に宿泊日を設定する。relative宿はbindingされた日付を利用する。
日別投影は初日にチェックイン、途中に連泊、最終日にチェックアウトとして同じitem IDを読む。予定時刻は宿泊spanの精度をfixedに変換しない。
予定時刻の変更は既存adoption/item decision再確認とcost stale判定を通る。予約resourceや営業条件を更新しない。
Agentの新しい専用Tool/Promptは追加しない。人の入力した時刻はTripに保存され、既存Agent操作のpayloadで置き換える際にも通常のaggregate検証が必要となる。

## 時刻入力と欠損情報

端末timezoneを使わない。入力したIANA zoneを使い、DSTの存在しない時刻は拒否。重複時刻はUTC差を明示するまで拒否する。活動終了日は任意で入力できる。省略時は開始日と同日。既存の翌日終了scheduleも終了日付きで編集する。
鉄道は全legsと前後の発着時刻、実際の乗換間隔を表示。minimumTransferMinutesを徒歩や待ち時間に置き換えない。
#809からSelectedRailJourneyの区間へoptional serviceType/trainName/serviceDestinationを保存する。検証に用いたimmutable TrainIndexの同一service_uidからのみ取得し、モデルの表示ラベルをコピーしない。新しい選択は新幹線・特急などの種別、列車名、行先を表示する。旧保存データは欠損を許容して列車番号だけを表示し、再検索・採用で取得する。路線名・platform・駅内徒歩分数は未保持。非鉄道の採用snapshotもmode/起終点/provenanceのみで内部legsや目的地までの徒歩を保持しない。検索中の公開カードは取得済みの区間情報を表示する。欠損データの追加保存は別モデル作業であり、推測補完しない。
公開スポット・宿カードの現行契約には評価点・評価件数がないため、星や点数を作らない。評価が追加される際は評価元・件数も同じ公開契約に含める。

## 見た目と検証

背景/本文/補助/線/blue/softはライトで`#ffffff/#243043/#667185/#e3e8ef/#2867a8/#f3f6fa`、ダークで`#171b21/#e3e9f1/#a4afbf/#343c48/#83b6ed/#222a35`。
本文14px/1.55、タイトル20px/500、補助12px、入力16px、操作44px以上。SVG線アイコン、薄い罫線、小さな角丸。プレビュー外枠は製品にコピーしない。

DomainとDOMテストで日別投影、未定後の追加、時刻登録、DST、人数の情報保持、旅程切替後の誤更新拒否、乗換間隔を確認する。
`verify_viewer_startup.mjs`は本番buildと合成APIで360/390/768/1280/1440pxの一覧・旅程・設定・各編集面、ダーク背景、横溢れと操作を確認し、CI artifactへスクリーンショットを保存する。実アカウントの旅行情報・模型の生成評価ではない。

## 本番画面の追加整理（#809）

相談panelはcompositionで`ai-guide-panel`から`consultation-page`へ変更されるため、前回のCSS scopeでは本文・composerへ適用されていなかった。相談画面の各要素を明示して14px本文、16px入力、白／グレー／ブルーの同じpaletteを適用する。運行画面もnav・Mapbox標準操作部だけを配色へ接続し、地図スタイル・列車の描画・時刻・カメラは変更しない。

旅程一覧は各行の末尾の「⋯」に名称変更と削除を格納する。「削除」は既存archive APIのsoft-deleteを使う。通常の復元UIがないことを確認前に示し、予約を取り消す操作ではないことを説明する。実アカウントのデータは検証のために削除しない。

確認ポイント・次に決めること・準備の集約パネルをWorkspaceから撤去する。成立性評価、予約保護、adoption/CASは継続し、該当itemと変更確認時に必要な問題を表示する。既存費用は「費用」の折りたたみで保持する。

同一replyに検索経路と採用案が含まれる場合、全candidateが単一transport、固定時刻、同一日、公開sourceRefとJourney IDが一意に一致する場合だけ、既存の採用buttonを各JourneyCardに配置する。一般の複合旅行案は独立表示を維持し、結び付けられないtransport案は「旅程に追加・変更」に折りたたむ。選択のordinalやタイトルだけから保存対象を作らない。既存preview/confirmのconversation・trip/revisionチェックを通す。

Markdownの空白付き閉じ太字はplain text token内だけ修正する。コード、escape、URL、raw HTMLは変更しない。safe DOMレンダラは保持する。

CIブラウザは合成の同一replyを履歴API経由で実際のconsultation compositionへ通し、14px・ライト/ダーク・重複パネル・Markdown・列車ラベルを確認する。これを実アカウントの旅程作成成功と同一視しない。
