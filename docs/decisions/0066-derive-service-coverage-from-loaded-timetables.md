# 0066 対応範囲を読込済み時刻表とアクセス根拠から導く

## 状態

Accepted

## 背景

#452は#366/#377の地点同定とは別に、サービスとして移動確認済みと扱える範囲を共有する。
駅名一覧、都道府県、地図上の近さだけでは指定日の到達可能性を証明できない。

## 判断

`@raiquora/trip/travel-coverage`を唯一のpure判定とする。西日本中心は製品の対象説明であり、
独立した地理境界をコードへ追加しない。対応範囲の拡大は運用側のversion付き入力の更新とレビューで行う。
現行StationLineCatalog、日付別入力、verified candidate、既存scheduled verificationを使用する。
代表ダイヤは将来の運行保証へ昇格しない。カタログ欠落は範囲外ではなくdata-unavailableとする。

非駅施設は解決済みPlaceと収録駅を結ぶ、取得済み・新鮮なGroundAccessを必要とする。
同名・近接だけではsupportedにしない。新しい探索、LLM判定、県名blacklistは追加しない。

## 選択肢と影響

静的地域allowlistは実データと乖離するため不採用。coverage専用検索エンジンも重複するため不採用。
CandidateAssessmentにbounded projectionを追加し、Home/Agentは同じ値を表示する。
rail採用境界は確認時も最新入力を再取得して再検証する。古いsupported表示は採用権限にならない。

coverageはTripの採用意思、ready、予約状態ではない。宿の選択や未確認の仮予定を保存しただけで
到達可能と表示しない。公開writerは閉じたまま。会話・追加調査を拒否せず、推薦・再探索の判断は既存Runtimeへ残す。

## 関連

#450 / #452 / #453、ADR 0052、[対応範囲契約](../architecture/travel-coverage.md)。
