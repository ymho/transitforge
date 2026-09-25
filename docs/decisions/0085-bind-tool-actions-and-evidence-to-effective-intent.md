# ADR 0085: Tool actionとEvidenceをEffective Intentへ束縛する

- ステータス: Accepted
- 日付: 2026-09-25
- 関連: Epic #631、#641、#642、#653、ADR 0084

## Context

Tool schemaが入力形だけを検証しても、日付訂正後の旧日付や、利用者が未定・非開示とした値をmodelが補完して実行できてしまう。また、取得済みEvidenceを会話条件の訂正後も無条件に再利用すると、結果自体が正しくても今回の条件には不適切になる。一方、意味変更ごとに全Evidenceを捨てると、無関係な調査まで反復し、Tool cacheと再試行制限にも矛盾する。

## Decision

Tool descriptorへApplication-ownedの`intentPolicy`を置く。policyは依存targetと、入力fieldごとの必須性・一致方法・許容精度/強度を宣言する。RuntimeはmodelのTool callを実行する前に、そのturnでApplicationがコンパイルした`EffectiveIntent`へ照合する。model出力に依存宣言やsource権限は与えない。

成功したTool EvidenceにはApplicationが`intentRevision`、Effective Intent fingerprint、依存targetを付ける。次turnの受理済みactual操作と依存targetが交差するEvidenceだけを失効する。依存情報のない旧Evidenceは、意味変更があったturnでは安全側で失効し、変更がなければ保持する。

feature rollout前の空projectionには検証可能な意味がないため、`intentRevision=0`かつbase/actual条件が空の場合だけ旧Tool経路を維持する。semantic acceptanceを有効化すると、同じcurrent turn receiptがmodel、Tool、Evidenceへ使われる。

## Consequences

- 日付・場所の訂正前入力、未定値の推測、必須入力欠落をTool境界で拒否できる。
- 無関係なEvidenceを保持しつつ、影響対象だけ再検索できる。
- read cacheの再評価は意味revisionと依存変更で説明でき、proposal/writeの冪等性は従来どおり維持する。
- 新しいToolは入力schemaだけでなく意味依存contractもレビュー対象になる。
