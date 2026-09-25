# ADR 0095: 複数ターン意味状態をServer Application経路で採点する

- ステータス: Accepted
- 日付: 2026-09-25
- 関連: Epic #631、#632、#647、#648、#654、ADR 0083、ADR 0094

## 背景

single-turnのInterpreter精度だけでは、後続発言で前の条件を保持できるか、訂正・撤回・仮定を誤って広いscopeへ適用しないか、受理状態が永続化されるかを判定できない。pure reducerへ完成済みdeltaを直接渡すだけでも、実際のServer受理順序、trusted calendar、Working State保存を通らない。

## 決定

30本の公開development scenarioを、入力、scripted provider応答、最終state goldの3 moduleへ分離する。入力はscenario ID、category、trusted calendar、利用者発言だけを持ち、expected operationやafter stateを持たない。

各scenarioは`createConversationTurnApplication`とDynamoDB adapter形fixtureを通す。ApplicationがInterpreter出力のquote、scope selector、相対日付を検証し、意味差分を回答前に受理・保存する。採点は全turn終了後のintent revision、fact、scope、modality、frame、tombstoneを確認し、Runtime inputにgoldを渡していないことも検査する。

初期30本は10カテゴリ各3本とする。カテゴリは訂正、無関係属性を保つ追加、日別scope、撤回、仮定frame、一般質問no-change、modality緩和、相対日付訂正、代替追加、明示的unknownである。地名だけを替えた同一fixtureへ偏らせず、操作と保持条件を分散する。

## 帰結

- A/B層で30 conversation・60 unique utteranceを決定論的に再実行できる。
- scripted providerの成功は実モデル品質を意味せず、#648のC層を置換しない。
- 12 message超、公開候補の並替後ordinal、Profile継承抑止、受理後の回答失敗・再送は既存の個別回帰も維持し、横断scenarioとして追加検証するまで#647/#654を完了扱いにしない。
- 実Browser、実Provider、本番gate有効化後のread-backは別のD層であり、このADRだけでは完了しない。
