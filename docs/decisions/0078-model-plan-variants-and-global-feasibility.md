# ADR 0078: 費用明細・旅行案・全体成立性をTrip正本から派生評価する

- ステータス: Accepted
- 日付: 2026-09-23
- 対象: #545, #548, #549, #550（親 #537）

## 背景

既存Tripは採用済み`items/schedule`を正本とし、4カテゴリのAI費用概算、pairwise成立性、単体TravelCandidate、
旅行中の安全なProposal previewを持つ。一方、部屋×泊数のような複合費用、3件以上の時間制約連鎖、
複数日案全体の比較、遅延・休業シナリオ、局所変更の派生評価範囲は表現できなかった。

## 決定

- `CostLine`は1つの経済的な請求を表し、`scope`と複数`dimensions`、数量、対象、coverage、source kind、
  Evidence、入力fingerprintを持つ。日別`CostAllocation`は派生表示であり合計へ再加算しない。
- 既存4カテゴリforecastは互換表示として維持する。明細が存在する場合、合計とcoverageは明細側を正とし、
  forecastをProvider観測・予約・支払価格へ昇格しない。
- 全体時間制約は差分制約networkとしてpureに評価する。Trip配列順をhard orderへ変換せず、明示before/after、
  participant/resource排他、移動下限、営業窓、予約anchorだけをedgeにする。
- 初期実装はBellman-Fordで矛盾cycleを検査する。一般solver依存は導入しない。予算打切りと未対応事実はunknownを返す。
- `ItineraryCandidateSet/PlanVariant/DraftTimeline/DraftPlanItem`を採用前だけの構造とする。単体`TravelCandidate`や
  Tripをoptional fieldで巨大化せず、候補は明示採用時だけtrusted factoryから既存`TripUpdateProposal`へ変換する。
- 比較はhard、unknown、soft、workload、cost、Evidence、変更量、scenario robustnessの各軸を保持する。
  通貨・根拠version・scenario集合が比較不能なら勝敗を作らず、単一総合点を保存しない。
- scenarioは元Trip/Reservation/Evidenceを変更しないoverlayとして同じ成立性networkへ適用する。通過件数は
  試験した仮定の結果であり、実世界の成功確率へ変換しない。
- 増分再評価はdependency indexが完全な場合だけ使う。不完全ならfull-conservativeへ広げ、fingerprint不一致は再計算する。

## 採用しなかった案

- 汎用制約solverの導入: 現在必要な差分制約に対して依存・運用・性能評価の負担が大きい。
- CandidateをTripへ全コピー: 採用前案が第二の編集正本になり、予約とCASの意味が崩れる。
- 総合おすすめ点: hard違反やunknownを魅力度で相殺し、異通貨のamountMinor比較を誘発する。
- シナリオ成功率の確率表示: 実測分布がなく、仮定集合の偏りを現実確率に偽装する。

## 制約と後続

候補の永続receipt・公開Presentation・Browser比較UIは#556/#559で同じIDを伝播する。予約・決済・取消は行わない。
networkが扱わないdisjunctionやProvider代替便はunknown/再検索要求とする。汎用solverが必要になった場合は、
30/90日計測と現実fixtureで現在実装との正確性・latency比較を行い、別ADRで判断する。
