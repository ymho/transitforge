# 旅程・相談・設定の刷新（#805）

最新main（#799 / #807完了）から、合意した旅程一覧・タイムライン・設定の見た目を適用する。
運行状況のMapbox画面は対象外。新CSSは`#app[data-primary-view]:not([data-primary-view="map"])`に限定する。

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
| 費用・準備 | 既存costs / reservation / checklistを保持。独立タブを廃止して折りたたんだ詳細へ |
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
現行SelectedRailJourneyは路線名・列車名・platform・駅内徒歩分数を保持しないため、保存済み旅程は列車番号と駅・時刻を表示する。非鉄道の採用snapshotもmode/起終点/provenanceのみで内部legsや目的地までの徒歩を保持しない。検索中の公開カードは取得済みの区間情報を表示する。欠損データの追加保存は別モデル作業であり、推測補完しない。
公開スポット・宿カードの現行契約には評価点・評価件数がないため、星や点数を作らない。評価が追加される際は評価元・件数も同じ公開契約に含める。

## 見た目と検証

背景/本文/補助/線/blue/softはライトで`#ffffff/#243043/#667185/#e3e8ef/#2867a8/#f3f6fa`、ダークで`#171b21/#e3e9f1/#a4afbf/#343c48/#83b6ed/#222a35`。
本文14px/1.55、タイトル20px/500、補助12px、入力16px、操作44px以上。SVG線アイコン、薄い罫線、小さな角丸。プレビュー外枠は製品にコピーしない。

DomainとDOMテストで日別投影、未定後の追加、時刻登録、DST、人数の情報保持、旅程切替後の誤更新拒否、乗換間隔を確認する。
`verify_viewer_startup.mjs`は本番buildと合成APIで360/390/768/1280/1440pxの一覧・旅程・設定・各編集面、ダーク背景、横溢れと操作を確認し、CI artifactへスクリーンショットを保存する。実アカウントの旅行情報・模型の生成評価ではない。
