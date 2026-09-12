# Trip V2 Schedule導入 (#386)

親方針は[#382](https://github.com/ymho/transitforge/issues/382)、正本契約は
[#415](https://github.com/ymho/transitforge/issues/415)、[ADR 0052](../decisions/0052-establish-trip-v2-contract-and-migration.md)。
本書は[Tripライフサイクル契約](trip-lifecycle.md)のscheduleを具体化した実装記録であり、別Tripモデルではない。

## Before / Afterと変更範囲

| 現行の時間表現 | #386での扱い |
| --- | --- |
| legacy sightseeing.date / manual movement.date | 同じconverterで実在日ならday、欠落はunscheduled、不正なら警告。旧型/reader/writerは変更しない |
| legacy TripJourneyPlan.departureDate / serviceDate / journeys[] | 暦日departureDateだけdayへ保存可能。業務日を暦日と見なさず、候補の先頭や補正時刻をfixedへ採用しない |
| legacy StayPlanItem.checkInDate / checkOutDate | day spanへ投影。宿候補や旧宿採用の証拠は従来どおり移行保留 |
| V2 SelectedRailJourney legs | 共通ZonedInstantを使用。first departure/last arrivalからfixedを投影 |
| V2 stay.selection.accommodation | 既存check-in/outが日付の正本。day spanと整合必須。新しい宿日時モデルは追加しない |
| Agent Context | legacy projectionは維持。V2はscheduleを構造化して渡し、windowを固定開始にしない |
| UI | pureな表示helperのみ追加。#390の画面切替は行わない |

主な変更は`modules/trip/domain/itinerary-schedule.ts`、`trip.ts`、`selected-rail-journey.ts`、
既存`legacy-trip-converter.ts`、候補採用usecase、Agent Context、`presentation/trip-plan`の表示helper。
追加framework/Provider/Plannerはない。IANA照合は標準Intl、既存日付の実在検証はsnapshot-validationを再利用する。
architecture checkerの文字列検索がscheduleの`"window"`をbrowser globalとして誤検知するため、
既存TypeScript compilerの構文木で識別子/直接globalアクセスを検査する。除外ファイルや許可例外は作らず、
実際のwindow/document/localStorage参照、template内参照、escaped identifierの負例をcheckコマンドで検証する。

## 同じItineraryItemのschedule

全transport/stayに必須の`ItinerarySchedule`を持つ。入力欠落を暗黙unscheduledへ置換せず、Domain境界で拒否する。

- fixed: `startAt`と任意`endAt`。終了不明とゼロ分を区別し、逆転を拒否する。
- window: `earliestStart`〜`latestEnd`の配置可能範囲。任意durationは非負の安全整数で、実経過分の幅以内。
  90分の予定を最早開始時刻に固定しない。DST前後もwall-clock差ではなくinstant差で検証する。
- day: 実在するLocalDate、任意endDate（exclusive）、任意IANA timeZone。endDateはdateより後。
  1日や連泊を00:00のfixedに変えない。zone不明は省略し、地名から推測しない。
- unscheduled: type以外のfieldを持たない。今日/現在時刻/0時のdefaultはない。

各variant/endpointはunknown keyをrejectする。LocalDateはYYYY-MM-DDの実在日であり、過去日を翌年へずらさない。
今は重複予定の調停や予約可否判定を実装しない。固定/柔軟の解釈、候補比較、追加質問は引き続きLLMが担う。
schedule typeをTool router/固定質問順のキーにしない。

## ZonedInstantとIANA

`{ at: string, timeZone: string }`の両方が必須。atは秒を含むoffset付きISO instantで、
そのwall-clockとoffsetが指定IANA zoneの当日の規則に一致しなければrejectする。
Europe/Viennaの夏+02:00、冬+01:00、春の不存在時刻、秋の重複時刻を検証する。
重複時刻は明示offsetにより2つのinstantを区別できる。offsetのないlocal timeは受け付けない。
`-00:00`（offset不明）やoffsetだけをzoneとして渡す値も拒否する。

ZはUTC offsetとして扱う。Tokyo 09:00は`09:00:00+09:00`とAsia/Tokyoの組合せで保持する。
#385/#414のrail constructorの`00:00:00Z`+Asia/Tokyoは同一instantの上記表記へ変更した。
V2 writerはまだ存在せず、本番legacyデータには影響しない。開発時の旧V2 fixture/一時値は
新constructorから再生成する。verifiedAt/selectedAt/retrievedAt等の観測・採用metadataはZのままで変更しない。
Intl/IANAデータの更新で将来の規則が変わり再検証失敗する場合、予定を無言で補正せず再確認対象とする。

鉄道入力の既知zoneはAsia/Tokyo。`railScheduledInstant(serviceDate, route_time_minutes)`は
業務日midnight + 分数を日付を保って表す。2026-09-21 +1460分は2026-09-22 00:20、
+1679分は同03:59、次業務日の240分は同04:00。起点を04:00へずらしたり、剰余で日付を落とさない。
既存の業務日選択、時刻表検索、画面時計の処理は変更しない。

## 計画正本との整合とProposal

`projectRailSchedule`は検証済みSelectedRailJourneyだけを受け取り、endpointをallowlistで新規構築する。
Trip validationはfixed/start/end/zoneを計画と比較し、不一致・終了欠落・別variantをrejectする。
生JourneyRouteResult/遅延/見込時刻は使わず、source/digest/乗換規則・再検証の境界を維持する。

`projectStaySchedule`はcheck-in/outをday spanに投影し、選択済み宿のplace.timeZoneがある場合だけ使う。
Trip validationはdate/endDate/zoneの一致を確認する。選択済み宿の滞在日変更は宿の日付と一緒にProposalへ載せる。
unselected stay/unresolved transportにはday/window等の要求段階の配置も保持できる。

候補採用usecaseはrail/stayの計画事実とscheduleを同時にreplaceとして提案する。
既存`TripPatch`のreplaceと`applyTripProposal`が同じinvariantを使うため、新しいschedule専用writerはない。
不正な複数Patchは途中適用しない。revision/updatedAtを更新する本番契約は#389のまま。

## 単一legacy converter

`convertLegacyTripPlan`だけを拡張する。railの証拠不足はunresolvedのままなのでfixedを捏造しない。
後にverified candidateを明示採用する場合に、上記共通projectionでfixedになる。
日付不正/逆転/同日checkoutは`unscheduled`+`schedule-invalid`（owner #386）とし、
原本保全必須フラグを返す。入力/移行実行日時で修復しない。

Activityは未導入のため、既存`placeMappings`に`{ itemId, place?, schedule }`を返す。
これは#410用のpure部分変換結果であり、新しいActivity型/保存形式ではない。Placeが保存許諾不明でも
ユーザーの日付は独立して保持できる。未知日時/原本情報をTripへコピーせず、同じ入力には同じ結果を返す。

## Agent / UIと評価

V2 snapshotはDomain検証後のscheduleをコピーし、全variant/endpointを`currentTrip.schedule[].schedule`へ渡す。
この深さを保つためcurrentTripの上限だけ4→6へ変更する。他Contextの深さ、件数、文字数、privacy filterは維持する。
Tool選択ルール、System Prompt、model call数は変更しない。schedule構造分だけ入力tokenが増え得る。

UI helperはwindowを「14:00〜18:00の間 / 約90分」、unscheduledを「時間未定」と表示する。
固定開始だけなら終了時刻未定と示す。日跨ぎは両日付、海外/DSTはzone/offsetを示す。
ブラウザのzoneや今日に依存しない。UIへ配線する責務は#390に残す。

Domain・converter・Trip/Proposal・候補選択・最終model Context・UI labelをテストする。
全体test/build/architecture/workspace、保存済み観測Smoke/Full Evalを実行する。
Live Evalは今回も設定済みAWSセッションが期限切れ（STS認証確認）で未実施。
保存済みFull Evalは実モデルの新schedule解釈の品質保証ではなく、既存評価ケースの回帰確認である。

## 未対応 / writer gate

#383 state、#387要求、#400宿snapshot最終形、#403多都市、#410 Activity、#411 party、
#412 Money、#413一般transport、#388保存/認可、#389 revision/CAS/冪等性、#390 UI移行を先取りしない。
LocalStorage writer/reader、server保存、dual-write、Conversation削除は変更しない。
schedule導入だけでV2を本番の正本へ切り替えない。
