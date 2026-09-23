# Epic #537 final Eval fixtures

`inputs.json`、`expected.json`、`observations.json`、`manifest.json`は物理的に分離する。
production compositionへ渡せるのは`inputs.json`だけであり、`expected.json`は実行後の決定論的採点だけに使う。
`observations.json`はparser/report契約のfixtureであり、実行結果そのものではない。静的な`passed: true`を実績証拠にせず、
A/Bを含む未取得値は`not_measured`と`null`で保持する。実観測はDomainまたはproduction compositionを実行したadapterから生成し、
その後にだけexpectedを採点へ渡す。0点、成功、A/BによるC/Dの代替には変換しない。

`manifest.json`はseed、clock、構造版、model、Provider/source、cache、料金表、prompt/schema/tool版と2×2全セルを記録する。
Liveセルは最低3反復を要求するが、3反復のp95や成功率を精密な推定とは扱わない。
