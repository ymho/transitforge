# ADR 0079: 旅行案の表示・保持・採用を型付き参照で接続する

- ステータス: Accepted
- 日付: 2026-09-23
- 対象: #556, #559（親 #537）

## Context

Agent内部の旅行案をMarkdownだけで表示すると、案の順序、日、元item、Evidence、比較、耐性、調査範囲がBrowserや履歴で失われる。またMarkdownを再解析してTripへ保存すると、表示文の変更が書込内容を変え、owner scope・revision CAS・予約保護を迂回し得る。長期旅程を会話receiptへ無制限に埋め込むとDynamoDBの256 KiB上限にも近づく。

## Decision

`PublicPlanPresentation v1`を表示正本ではなくversioned read modelとして導入する。Presentationは候補順、日順、`entryRef`と`itemRef`、Evidence/photo参照、coverage、fact/proposal/assumption、比較・scenario・research outcomeを保持する。Tripに結び付くPresentationとWorking State receiptは`tripId + baseTripRevision`へ束縛する。Runtimeがmodel/tool回数とwall-clockを上書きし、model自己申告値を公開しない。

保存可能な案は`ItineraryCandidateSet`をowner・conversation・revision付きのimmutable DynamoDB itemとして最大180,000 bytesで保持する。`expiresAtIso`は適用可否を判定するISO時刻でありDynamoDB TTL属性ではない。期限切れ候補は読めても採用できない。Conversation削除時はcandidate/adoption previewもowner・conversation prefixでresumableに削除し、Conversationを残した期限切れ候補の物理evictionだけを将来の明示的cleanup jobへ残す。会話履歴には候補本体でなくrefだけを残す。

候補生成境界はserver-issued ID、request fingerprint、Trip revision、発行・期限を設定し、canonical variantとPresentation順序の一致を検証してから保存する。legacy `travel-plan` projectionは実在するCandidateSetを捏造せず`unavailable`とする。

採用は次の経路だけとする。

1. retained typed candidateをowner/conversation/revision付きで取得
2. trusted factoryで既存`TripUpdateProposal`へ変換
3. bounded change previewとconfirmation keyをimmutable receiptへ保存
4. 利用者の明示確認をtrusted host authorityとして照合
5. 既存Trip ApplicationのReservation protection・CAS・mutation receiptで保存
6. owner-scoped read-backで確定結果を返す

Markdown、Browser内状態、modelのconfirmation fieldは保存入力にしない。同じmutation IDの再送はpreview receiptと既存mutation receiptから同一結果を返す。

## Consequences

- 7日・30日でも同一契約から日別・全体・比較・費用・負荷・unknown・耐性・調査状況を表示できる。
- 連泊等は複数`entryRef`から1つの`itemRef`を参照でき、費用・予約を複製しない。
- 180 KiBを超えるPresentation/CandidateSetはsilent truncationせず失敗し、参照/chunk化の要否はPR7の90日測定後に判断する。
- 旧会話のPresentationなし本文は引き続き表示できるが、typed candidateとして直接採用できない。
