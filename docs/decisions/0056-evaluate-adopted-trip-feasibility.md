# ADR 0056: 採用済みTripの成立性を派生評価しready確定を検証する

- ステータス: Accepted
- 日付: 2026-09-13
- 対象: #402（親 #382/#415）、ADR 0052〜0055

## 背景

候補Assessment (#406) は採用前の比較である。既存hard constraint評価は個別条件だけを扱い、
採用済みTrip全体の時間・移動・予約整合を証明していない。readyは#402まで一律拒否されていた。

## 決定

- `evaluateTripFeasibility`をpureな共有Domain評価とする。Tripへfield/評価履歴を追加しない。
- `feasible / infeasible / unknown`、revision、評価時刻、code/関連IDを返す。違反はunknownより優先する。
- Schedule/Place/SelectedRailJourney/Money/effective constraintsを再利用し、Rail transferを再実装しない。
- 予約は独立ReservationReaderの`ReservationFact`のみ。外部事実は取得済みEvidence付き、採用itemへ結び付いた短命なinput。
- Applicationで変更後のTripを評価する。既存CASでその内容だけを保存し、評価の自己申告やrevisionだけの証明を受理しない。
- ready policyをoverall statusと分離する。`blocksReady`は違反と必要事実の欠落を拒否し、selected Stayの正当なday精度、取得済み移動のStay前後の時刻精度、宿泊予約の日付整合後の時刻精度、衝突未解決でないbounded window精度だけを許容する。unknownの表示・評価は消さない。
- Domain構造validationからready一律禁止を外す。構造的に正しいreadyの読み取りと、今回readyを認定する操作を分離する。
- Agent/UIは同じ派生結果を説明する。新Tool/固定質問順/外部API必須pipeline/model callは追加しない。

## 選択しなかった案

- Candidateをそのまま評価: 採用済み順序・予約・current revisionが失われる。
- Tripへ評価を永続化: 取得情報の失効とrevision変更で二重の正本になる。
- 全unknownを拒否してready: selected Stayが必ずdayというinvariantと組み合わせると、宿泊旅行が永久にreadyになれない。
- 全unknownを許可してready: route未取得、hard constraint未確認、予約必須の未確認まで素通りする。
- 保存readyをschemaで拒否: 後から情報不足になった旅行を読み込めず修正もできない。

## 制約と後続

windowの成立可能は未配置としてunknown。ホテルの日付spanをチェックイン15時や24時間占有へ変換しない。
全世界の営業時間、運賃、主観疲労、#401 Hazardは実装しない。公開認証/writer gateはOFFのまま。
TripとReservationのcross-resource transactionは#398の限界を維持する。直後の外部変更まで保証しない。
契約・AC・確認方法は[Trip Feasibility](../architecture/trip-feasibility.md)を参照する。
