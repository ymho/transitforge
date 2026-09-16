# ADR 0061: 共通subject routingで天気・警報のTrip暴露を評価する

- ステータス: Accepted
- 日付: 2026-09-15
- Issue: #408、親 #382/#415、前提 #393/#394/#401

## 現状と決定

WeatherForecastにはhourlyの気温・降水確率・降水量・weatherCode、明示timezone、位置があるが、
TravelEventのweather factは単点値だけだった。Hazard mapper、Watch projection/reconcile、
subject routing、Impactのowner-scoped保存とTrip revision fenceは既にある。

WeatherEventFactを同じTravelEventの中でbounded forecastへ置換し、Weather/Hazard用のpure評価器を追加する。
別WeatherImpact/HazardImpactモデル、保存table、Watch同期、候補Assessmentは作らない。
Trip/Reservation/Checklist/planned Feasibility/Agentは変更しない。通知・自動再取得は#395/#409。

## Routingの選択と移行

種類別GSI追加、既存GSI置換、既存物理GSIの意味拡張を比較し、最後を採る。
既存canonical subjectには種類が含まれ、weather/hazard/railは衝突しない。
`TripImpactRouter`、`DynamoDbTripImpactRouter`、`TripImpactApplication`へ共通実装を移し、
#394のimportには小さいre-exportだけを残す。既存Impact Repositoryは一切複製しない。

物理名`rail-watch-routing`、属性`railSubject`、Lambda/package名、metric namespace `Raiquora/RailImpact`
は互換性のため維持する。これらは今回から全3種を扱う内部resourceである。
索引の置換/増設、IAM追加、二重書込、別キューは不要。Agent/public HTTPへの権限追加もしない。
旧area Watchの属性欠落は読み出し可能なまま、次の既存reconcileが同じTrip条件・collection CASで補修する。
未同期の既存Tripはtrusted hostによる明示対象のreconcileが必要。Scanで全ownerを列挙しない。

[DynamoDB GSI](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GSI.html)の結果整合は残る。
KEYS_ONLY hint → owner-scoped base collection → complete/active/sourceTripRevision/exact subject → latest Trip
を再検証する。空でも非空でもreceiptはeventual/replayRequired。coverage完了やno-impactの証拠にしない。

## Weatherの時間・入力契約

trusted `WeatherEventTarget`はsubject、実行したquery、解決済みの正確なlocation/座標/timezoneを持つ。
既存WeatherForecast結果は名前・座標・timezoneをtargetと照合する。施設名やLLMから区域を推測しない。
queryの開始/終了日は必須、最大7暦日、168hour/7日未満のsample幅。範囲外・件数超過は切捨てず拒否する。
長期/DSTで件数超過の場合、hostは小さい期間に分けて再取得する。API上限そのものを変更するものではない。

[Open-Meteoのhourly仕様](https://open-meteo.com/en/docs)では降水量・確率は直前1時間、
気温・weatherCodeはサンプル時刻の値である。Eventに`precipitationPeriod=preceding-hour`を明記し、
`at`をUTCのcanonical instantへ正規化する。Impactでは降水区間と`sampleAt`を分ける。
現在のWeatherForecast契約にない風速、独自の天気予測、temperatureの時間平均は生成しない。
新Providerが異なる時間basisを持つ場合はAdapter/契約を明示拡張し、そのまま流用しない。

offsetなし時刻はIANA timezoneで一意に解決できる場合だけ受理する。DST fold/gapは推測せず拒否する。
offset付きならinstantを維持する。host/browser timezoneは使わない。重複/逆順hour、範囲外日付、
非finite値、負の降水量、範囲外確率、未定義weatherCode、座標不正を拒否する。
raw response、daily、風速等はallowlistに含めない。下流のEvent validatorも未知fieldを拒否する。

Event IDはsubject・scope・time basis・hourly状態・freshnessから構成し、取得時刻/Evidence IDだけの
更新で増殖しない。hourlyはcompact tuple化してidentityをboundedにする。旧単点weather Eventは
#393で永続store/producer未導入だったため移行対象はない。再投入は新しい正本mapperを使う。

## weather-hazard-exposure-v1

Event freshだけを信用せず、評価時刻でEvidence validity・kind/confidence・未来時刻・最大1時間の
観測/取得経過を再確認する。明示validityなし、stale、unavailable、failedはunknown。
1時間はこの評価policyの上限であり、providerの短いvalidUntilがあればそちらも満たす必要がある。

- fixed: 半開区間の交差。終了不明はunknown。サンプル17時の降水は16〜17時に照合する。
- window: earliestStartを固定開始にしない。各hourとの必須/可能交差に加え、降水区間のunionと
  durationからweather-placement definite/possible/noneを計算する。最長の無降水gapがduration未満なら
  全配置で交差する。全windowのforecast coverageがない場合はplacementのnoneを断定しない。
- day: itemの明示timezoneで日付だけを比較する。宿泊を00:00固定appointmentへ変換しない。
- unscheduled/zone不足: 時間関係unknown。予報の欠測/gap/期間外はforecast_coverage unknown。

初期実装では気象値自体をweather-exposureへ保持し、Activityへの支障はweather_sensitivity unknownとする。
小さいoptional `VerifiedWeatherSensitivity`はitem/area/precipitation-sensitive/verifiedAt/既存sourcesのみ。
現在のActivity名やcategoryからは生成しない。Domain seamで受ける場合もobserved Evidence/時系列/validityを検査する。
本番compositionに検証済み属性のresolverはまだなく、未提供を既定値で補完しない。

検証済み降水感受性があり、該当予定の必須区間で降水がある場合だけattentionにできる。
雨量/気温だけの全Trip共通severity閾値は置かず、action-required/criticalは生成しない。
感受性あり・covered・無降水時のno-impactも、この降水policyで具体的支障を検出していない意味に限る。
すべての暑さ・雷・道路・施設営業が安全という証明ではない。

## Hazardの限界を保持する

`hazardTravelEvent()`は変更しない。query-limited coverage、公的severity、opaque ID、Evidenceを再利用する。
areaは検索scopeであって施設の包含証明ではない。title/summaryを読んで市町村を推測しない。
issuedAtも警報のvalidFrom/validUntilではない。

観測instantが予定と重なる場合だけhazard-exposure（observed-during/possible/date-only）を記録する。
これはその時に取得した区域内候補情報であり、施設に対して全予定期間有効な警報とは説明しない。
hazard_coverage/hazard_validity unknownを必ず併記する。未来予定への適用期間は不明のまま。
空feedは安全証明にならない。関連alertはattention止まりで、public emergencyをcriticalへ写さない。

## 保存・公開・後続

typed factsは既存TripImpactFactへ追加。自由文・raw・Notification状態は持たせない。
既存TripImpact Repository、deterministic ID、owner fence、Trip条件付きtransaction、無期限履歴を再利用する。
旧revision Impactは旧履歴。Trip更新やblind rebaseはしない。

IAM-onlyの既存内部Lambdaが3種のTravelEventを受ける。hostは`createInternalTripImpact`から
`ingestWeather(target,result,observedAt)`/`ingestHazard(query,result,observedAt)`を呼べる。
seamは取得済みProvider resultを受けるところからで、実際のProvider IO/再取得時刻は#409が担当する。
trusted scopeを解決できなければWatchを作らず未確認とする。既定空resolverを勝手な地名推定で埋めない。

#409: trusted target resolution、Provider IO、期間分割、replay/recheck・時間起点の再投入。
#395: 通知policy/resource/delivery。#396: bounded Context/表示。#397: 確認付き再計画。
本IssueはChecklist、Notification、Agent、Provider API、public writer gateを変更しない。
