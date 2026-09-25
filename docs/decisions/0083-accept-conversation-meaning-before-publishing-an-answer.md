# ADR 0083: 会話の意味差分を回答公開より先に受理する

- ステータス: Accepted
- 日付: 2026-09-25
- 関連: Epic #631、#632–#654、ADR 0074 / 0076 / 0079 / 0080

## 背景

ADR 0074のWorking Stateは公開済みpresentation、Evidence、前回outcomeを保持するが、利用者が会話で追加・訂正・撤回した条件は回答完了時まで保存されない。したがってProvider failureやschema repairの失敗で回答が作れないと、正しく受理できた「明日出発」「大阪から」も次turnから失われる。一方、保存済みTrip/Profileの変更には既存Proposal、確認、owner/revision検証が必要であり、会話中の希望を覚える処理で迂回してはならない。

## 決定

会話の意味状態を、既存`ConversationWorkingState`の疎な`semantic.overlay`として保持する。Trip、TripRequest、Profile、Proposal、Evidence、PlanVariantの内容を複製せず、会話で受理した差分、明示的なtombstone、bounded receiptだけを置く。

turnには二つのcommit pointを設ける。

1. **A: intent acceptance** — trusted Applicationがモデル出力を検証し、ID、owner scope、turn provenance、calendar anchor、base intent revisionを付与する。TURN receiptとWorking Stateを同じDynamoDB transactionで保存する。
2. **B: answer publication** — Runtimeが検証済み回答・presentationを作った後、assistant message、公開receipt、Working Stateを既存transactionで保存する。

A後にBが失敗しても意味状態を保持する。同じturnの再送はAのreceiptを再利用してInterpreterを再実行せず、Bだけを再開する。Bは読込時点の最新semantic stateをmergeし、別turnの訂正を古い完了処理で上書きしない。A前の不正schema、引用不一致、relative dateのtrusted anchor欠落、revision conflictは確定状態へ入れない。

モデルは現在の発言から小さい候補差分だけを返す。owner、権限、ID、revision、timestamp、解決済み相対日、Trip write、予約、Evidence、回答本文を生成しない。Applicationがexact quote、型、上限、対象と値の整合を検証し、相対日をturnに固定された`calendarDate`から解決する。Structured Output v4のanswer/askを巨大なDecision Summaryへ戻さない。

意味状態は会話overlayであり、保存済みTripの正本ではない。会話条件の受理に確認ボタンを要求しないが、Trip/Profile/Reservationの永続変更、別Trip作成、Proposal採用は既存のauthority、confirmation、CASを必ず通る。仮定frameはactual条件へ昇格させない。

Working State v1は空のsemantic stateとして読む。新規更新はv2で書く。未知versionは拒否する。初期導入は`SEMANTIC_INTENT_ENABLED=false`でread-old/write-new readerを先行配置し、rollout中も旧会話をmigrationなしで読めるようにする。

## 却下した案

- 会話履歴を毎turn再解釈する: 履歴切詰め、言い換え、Provider障害で状態が変わり、同じ入力から同じ結果を再現できない。
- TripRequestへ即時保存する: 会話中の仮定・許容・質問と、確認済みTrip変更の権限境界を壊す。
- 回答完了transactionだけで保存する: 回答生成失敗時に受理済み条件を失う。
- モデルに全状態、ID、revisionを再生成させる: schemaを肥大化し、authorityとCASをモデル出力へ委ねる。
- Prompt、regex、UI推測ごとに条件抽出を追加する: 同じ発言が経路別に異なる意味となる第二正本を増やす。

## 影響と後続条件

- #632の最小縦断として、自然言語→小さいStructured Output→Application検証→reducer→A保存→同じturnのRuntime読込をproduction compositionで通す。
- このADR時点の型は最小核である。scope/ref/frame/condition、authority、Effective Intent、派生失効、Proposal/variant、public receiptは後続waveで拡張する。
- 専用Interpreterは初期の安全な接続点であり、通常turnを恒久的に二重推論へ固定しない。#652でRuntime native Toolとの統合または同等の単一判断経路を、品質・cost・latency測定に基づき選ぶ。
- `recoverPlanningDraft`や`verifiedPlanningSummary`等の旧自然言語解釈は、新経路が同じ回帰と言い換えを通すまでは削除しない。置換後は安全な縮退だけを残す。
- intent receiptはConversationと同じ保持・削除境界に従う。raw Profile、raw Tool本文、chain-of-thoughtは保存しない。
