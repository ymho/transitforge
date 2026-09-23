# 費用・成立性・複数案・再計画の契約

## 正本と派生

| 情報 | 正本 | 派生 |
| --- | --- | --- |
| 採用済み計画 | `Trip.items/schedule` | 時間制約network、成立性、負荷 |
| 費用 | `TripCosts.lines`の1請求1行 | 日別allocation、通貨別合計 |
| 採用前の案 | `ItineraryCandidateSet/PlanVariant` | 多軸比較、scenario評価 |
| 変更 | `TripUpdateProposal` | delta、影響scope、preview |
| 予約 | 独立Reservation resource | protection/再確認要求 |

Candidateを採用済みTripとして扱わず、評価結果を第二の編集正本にしない。Proposal生成とCAS保存、予定変更と
実予約変更を分ける。

## CostLine

`forecast/provider_observed/user_override/reservation_price/paid_price`を分離する。`basis.scope`は旅行全体・パス・
共有資源、`dimensions`はperson/room/night/leg/unitを組合せ可能にする。unit amountは全dimension数量が既知のときだけ
合計へ入る。未知人数・部屋数・泊数、部分返金、税・手数料coverage不足を0円にしない。

同じline IDの同一参照は1回だけ合計し、内容が違う重複IDは拒否する。Allocationはlargest-remainderで原額を保存し、
`derived: true`として再集計対象にしない。異通貨は通貨別に残し、FX source/time/pair/roundingなしに換算しない。

## 全体成立性

各itemのstart/end変数とduration、明示order、travel lower bound、opening window、reservation anchor、
participant/resource orderを同じnetworkへ置く。全fixed/window間へTrip配列順を暗黙追加しない。
Stayの日spanは滞在拠点であり排他的な連続占有にしない。

結果はfeasible/infeasible/unknown、coverage、missing facts、conflict edges、budget打切りを返す。
repair candidateはProposal候補であってhard制約や予約を自動変更しない。

## 複数案とscenario

PlanVariantはcomponent IDとbase item対応、明示placement、条件付きexclusive group、coverageを持つ。
比較は単一scoreを作らず、Pareto dominanceも比較可能な軸だけで行う。異通貨、異なるfacts version、異なるscenario集合は
直接比較しない。Discovery/Rerank rankは資料関連度であり、旅行推薦順位とは別に保持する。

遅延15/30分、雨、休業、交通利用不能、滞在短縮は`DisruptionScenario`としてoverlayする。出力は破綻・不変・喪失・
再検索・代替・追加時間/費用・予約影響を持つ。hypotheticalとobservedを別にし、scenario pass countを確率と呼ばない。

## 局所再計画

day/segment selectorはServerの完全なTripからitem集合へ解決し、モデルへ渡した抜粋を認可に使わない。
deltaから前後接続、同日、区間、共有費用、Evidenceへ依存を伝播する。cache再利用はsource scope、valid time、retention、
principal、fingerprint一致が条件。不完全indexは全再評価へ広げる。

増分結果はfull recomputationをoracleにした決定的property testで一致を確認する。stale revision、booked/fixed/hard、
過去、対象外は既存confirmation/CAS policyを維持し、無関係な日・宿・予約を変更しない。
