# ADR 0082: 本番model routingを層別Final Evalの実測で判定する

- ステータス: Accepted
- 日付: 2026-09-23
- 対象: #537, #561

## 背景

Epic #537は旅行構造、検索、Evidence、候補比較、表示、採用、保存、部分再計画を同時に変更した。
固定fixtureの成功だけで実モデル品質や公開経路を証明すると、期待値注入、production loader迂回、Provider取得数を
公開数とするproxy、未測定値の0化を見逃す。構造before/afterと現行/上位モデルを比較する際も、旧構成に存在しない
APIを無理に合わせればモデル差と接続差が交絡する。

## 判断

Final Evalを次の4層へ分け、reportに層を必須記録する。

1. A: pure Domain。
2. B: production composition＋合成repository/Provider/model。独自`loadContext`による正解注入を禁止する。
3. C: 同じproduction composition＋実モデル＋合成Provider。
4. D: 実Provider＋実Browser＋Server保存。

入力、期待値、観測、run manifestを物理分離し、期待値は実行完了後の採点だけに使う。構造before/after×current/upperの
2×2全セルを保存し、未実施は`not_measured`と`null`にする。Liveセルとmodel比較は最低3反復を入口にし、全反復と失敗を残す。
seed、clock、model/region/推論設定、Provider/source、cache、料金表、prompt/schema/tool版、互換不能点をmanifestへ保存する。

正確性、権限、ID、金額、二重計上、保存整合はコードで検査する。魅力、比較の有用性、日本語の自然さはrubric付きの
人手または独立評価を併用し、LLM judgeを唯一の正解にしない。A/B成功でC/Dを合格にせず、安全・正本・根拠違反を平均点で相殺しない。

## Routing判断

このrevisionではC/Dと2×2 Live比較が未測定なので、現行model routingを維持し、上位モデル採用も軽量化も推薦しない。
これは現行モデルが優位という判断ではない。上位モデルが意味解釈、Tool選択、長期参照で有意に改善し、権限・保存・根拠指標を
維持する場合は用途別routingの候補とする。構造改善でモデル差が消えるとは仮定しない。

A01〜A04は個別効果→有望設定の統合→held-outの順で測る。KB/Rerank/Prompt Cacheはadapterやfixtureだけで本番有効化済みにしない。
AgentCore Runtime全面移行は採用しない。current Server Agentのbounded実行とreceipt再取得を維持し、長時間checkpoint/resumeが
実測上必要になった場合だけ#560の測定と追加ADRで再検討する。

## 影響

- CIはA/Bの回帰を検出できるが、Epic完了や本番routing変更を自動承認しない。
- C/D、paid Live、実Browserが未実施なら#561の該当ACは未達のまま残す。
- 最低3反復でも小標本であり、p95や成功率に過度な精度を与えない。分散・失敗が大きければ追加標本を設計する。
- 旧構成と新構成が非互換なcaseは交絡として残し、単純な改善率で因果を断定しない。

## Rollback / 公開条件

評価contractとfixtureは追加的で、本番routingを変更しない。rollbackはFinal Eval runner/fixtureの除去で行える。
公開またはrouting変更は、C/Dの必要層、権限・根拠・保存のblocking指標、cost/latency、失敗artifactを確認し、
採用/不採用理由をこのADRの後続へ記録してから行う。
