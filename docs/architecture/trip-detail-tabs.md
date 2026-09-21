# Trip詳細の4タブ（#459）

Trip詳細は「概要・旅程・費用・地図」を同じServer Trip V2から投影する。タブごとの保存モデルや
Browser内のTripコピーは持たず、再読込・変更確認・CASは既存`TripWorkspaceSource`を使う。

- 概要はTripの名称、状態、今回人数、採用済み地点と、Requestのテーマ・出発地・日程を表示する。
  Requestと採用済みitemは別の意味として表示し、未設定値を固定文言で補わない。
- 旅程は既存の日付bucketとitem cardを使う。日付タブはTripから可変生成し、`fixed/window/day`の
  authored local dateを維持する。`unscheduled`は「日時未定」、宿泊spanはcheck-in日の1カードとする。
- 費用は[AI費用概算](trip-cost-estimates.md)の保存済みforecast/override/合計をそのまま表示する。
  タブ切替はDOMを破棄しないため、確認前の入力も維持される。
- 地図は`projectTripPlaces`で採用済みitemだけを投影する。保持済み座標がある地点だけを既存Mapboxへ
  Marker表示し、座標不明地点は一覧で未確認とする。経路geometryがTripにない区間を直線で補完しない。

Mapbox overlayは地図インスタンスごとに1個だけ生成する。同じTrip revisionの再表示ではMarkerを再生成せず、
Trip/revision変更時は旧Markerとイベントを除去してから置き換える。Mapbox token不足や起動失敗は既存の
地図エラー境界で処理し、概要・旅程・費用はそのまま利用できる。

タブはnative buttonと`tablist/tab/tabpanel`で構成し、左右キー、Home、Endで移動できる。
日付タブも左右キーに対応する。選択外panelは`hidden`でfocus対象から外す。
