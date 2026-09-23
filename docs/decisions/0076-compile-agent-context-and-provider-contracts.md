# ADR 0076: Agent Context・Provider schema・Tool実行をversioned contractで接続する

- ステータス: Accepted
- 日付: 2026-09-23
- 関連: #553、#554、#555、#557、ADR 0068 / 0074

## 背景

本番経路はBedrock ConverseへTool schemaを渡していたが、`additionalProperties`等を落とし、出力は`<decision_summary>`本文を再parseしていた。現在要求は1,500文字、Trip itemは先頭24件へ縮退し、未取得itemへ到達するread Toolもなかった。Toolのsignal/deadlineはoperation境界まで届かず、Provider失敗とContext/表示/保存の劣化原因を安全に分けられなかった。

## 決定

- Provider非依存の`OutputContractRef`とcanonical JSON Schemaを正本にし、canonical JSONのSHA-256をschema identityとする。
- Bedrock adapterは明示的なmodel ID/API/region capability matrixからだけ`outputConfig.textFormat`、`toolSpec.strict`、Prompt Cache checkpointを組み立てる。model名の推測はしない。
- Provider subsetで表現できない長さ・数値境界はmanifestへ残し、Application検証を必ず継続する。非対応/未実測modelはapplication strict JSONとboundedなRuntime repairを使い、provider strictと同じ保証を表示しない。
- Context Compilerはstableなsystem/Tool/schema参照とdynamicなcurrent request/Working State/Trip/Evidence参照を分ける。8,000文字まで受理した今回要求を無言で1,500文字へ切らない。
- Trip全文を送らず、owner/Tripがtrusted scopeへ束縛された`get_trip_items`でrevision付きpage/detailを取得する。partial coverageとcontinuationを必須化する。
- Tool contractは`effect: read|proposal`、capability、prerequisite、typed error、signal/deadlineを表す。並列化は独立readだけに限定し、予算は開始前に同期的に確保する。
- 診断はversioned allowlist eventを注入sinkへ送り、生会話、Profile本文、精密座標、予約番号、私的推論を保存しない。sink失敗は通常応答を壊さず、欠落をログ分類する。

## 互換性

旧Decision tag parserは`outputMode=legacy_text`またはmetadata未返却の移行fixtureだけに限定する。strict応答を旧parserで再解釈しない。既存Tripのmigrationは不要で、read cursorはrevision変更時に`stale_revision`となる。Prompt Cachingは構成スイッチ既定OFFで、capability未実測時もcheckpointを送らない。

## 計測

Traceはoutput mode/schema hash、cache read/write tokens、cache status、latencyを別fieldで保持する。未返却値は0へ変換しない。実Bedrockのcold/warm、TTL失効、料金比較は認証可能なLive評価で行い、ローカルfixture値を実課金値として扱わない。
