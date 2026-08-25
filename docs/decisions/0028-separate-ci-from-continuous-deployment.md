# ADR 0028: CIと継続的デプロイを別Workflowへ分離する

## 状態

採用

## 背景

従来は1つの`CI` Workflowにtestとdeployジョブがあり Actions画面で検証とデプロイの
責務を判別しにくかった。deploy側でも依存解決 build Terraform initを行うため
改善対象の所要時間も分けて計測できない。

Agent EvaluationをPR用Smokeと手動または定期Fullへ分ける前に 通常CIとAWS変更の境界を
安定させる必要がある。

## 決定

- `.github/workflows/ci.yml`を`CI / Test`としてPR main push 手動実行の検証だけにする
- `.github/workflows/cd.yml`を`CD / Deploy`としてAWSデプロイだけにする
- 自動CDはmainの`CI / Test`が成功した`head_sha`だけをcheckoutして実行する
- 手動CDはmainからの実行だけを許可する
- 同じdev環境の古いCDはconcurrencyで取り消し 最新revisionを優先する
- CIとCDでTerraform provider cacheを使う
- AWS認証と秘密値はCDの`dev` Environmentだけで扱う

CIのtest tokenで作ったviewerをCDへ流用すると 実際のMapbox tokenを含むproduction buildを
保証できない。そのためviewer build artifactは共有せず CDで秘密値を注入して再buildする。

Terraform applyをUI差分だけで省略すると 外部変数変更やdriftを反映できないため 現時点では
毎回planとapplyを行う。安全に変更種別を判定できる契約を導入するまでは省略しない。

## 結果

- Actions画面とrequired checkでCIとCDを区別できる
- CI失敗revisionは自動デプロイされない
- CDの権限と秘密値がPR workflowへ広がらない
- provider download時間をcache hit時に削減できる
- CDでは依存解決とviewer buildを継続する
- workflow分離後の実測時間をIssueへ記録して次の最適化を判断する

## 検証

- PRでは`CI / Test`だけが実行されること
- mainのCI成功後に同じSHAの`CD / Deploy`が実行されること
- main以外からの手動CDがskipされること
- CI失敗時にCDのdeploy jobが実行されないこと
