# ADR 0026: Agent応答をGroundingしてからViewer Actionを実行する

## 状態

採用（直接Viewer操作の公開はADR 0049で停止）

## 背景

経路検索と比較を複数Toolで行うAgentは 最終回答と同時に経路の強調やEvidence表示を提案する。
本文だけを受け取る構成では どの主張がどのEvidenceに基づくかを決定論的に検証できず
根拠のない回答を表示した後でViewerを操作する可能性がある。

また`compare_journeys`へ経路本体をモデルから渡すと 検索していない候補の生成や別タスクの
結果の混入を防げない。

## 決定

最初のGrounded End-to-Endシナリオでは モデルの最終応答を次の構造へ限定する。

- 利用者へ表示する本文
- Evidence IDを参照するClaim
- 列挙型のViewer Action

RuntimeはClaimを`validateEvidenceAndClaims`で検証し unsupportedな事実が1件でもあれば
本文とViewer Actionを採用しない。Viewer ActionはGrounding成功後にだけ
`EvidenceScopedViewerActionHandler`へ渡し 同一`executionId`で収集したEvidenceから作った
task scopeに対して実行する。

`search_journeys`は検証済み結果を実行単位のboundedなメモリへ保存し opaqueな
`searchResultId`だけを返す。`compare_journeys`は同じ実行のIDだけを解決し モデルから
経路本体を受け取らない。

## 結果

- 検索 比較 Grounding Viewer操作を1本のTraceで追跡できる
- 根拠のない鉄道事実を安全側で拒否できる
- ViewerはToolで検証した経路とEvidenceだけを操作できる
- 検索結果の保持はprocess内かつboundedであり 永続的な会話状態には使わない
- 本文中の全事実がClaim化されているかはEvaluationでも継続して検査する

## 検証

- offline fixtureで`search_journeys`から`compare_journeys`を順に実行すること
- 遅延を含む比較結果のClaimがEvidenceでsupportedになること
- 検証済み経路の強調とEvidence表示だけが適用されること
- 存在しないEvidenceを参照するClaimでは回答とViewer操作を拒否すること
