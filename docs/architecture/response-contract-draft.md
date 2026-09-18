# 一般回答の出力契約（#375 / #376、Draft）

## 棚卸しと今回の境界

Converse native Tool UseだけをRuntimeが実行する。本文のXML/JSONはwire形式違反として破棄し、引数抽出・Tool routingには使わない。一般回答・既存InTripAnswerPlan・内部推論のみの応答が同じturn内のrepair budget（最大1回）を共有する。通常の結果駆動replanとruntime limitsは維持する。

既存EvidenceClaimへ任意のtyped binding（subject / facts）を追加し、既存validatorが同じEvidence内の完全一致を検査する。新しいEvidence正本は作らない。Default generatorでは具体的事実にbindingを要求し、その値から本文を描画する。Structured generatorも同じClaim parserを使う。Applicationの決定論的terminal表示とInTripAnswerPlanは独立した既存の表示境界を維持する。

## 未完了・マージ不可

- 一般回答の既存scripted fixtures / Ask + Progressとの統合は未完了。全test・Smoke/Fullは不合格。既存thresholdを下げて成功扱いにしない。
- `no_factual_claim_required`のモデル自己申告を使う自由文には意味検証の限界がある。これで自然言語の完全なentailmentを保証したとは扱わない。一般回答contractの非事実部分と事実部分の安全な分離が残る。
- Bindingを本文へ描画するprototypeはfield名のままなので利用者向け表現の改善が必要。
- datasetの次の空きIDはAV。新しいEvalケースのdataset/runner統合は未完了。隣接テストのtyped負例を追加しただけでEval完了とはしない。
- Liveの独立経路検索は不合格（`invalid_used_evidence_ids`）。native Tool成功のLive確認は未達。

Trip、認可、CAS、モデル/temperature、評価threshold、CDは変更しない。以上を解消するまでDraftを維持する。
