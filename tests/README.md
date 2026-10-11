# テストガイド

## TypeScript

対象モジュールと同じディレクトリへ`*.test.ts`を置く

- 共有Domainの計算と契約は`modules/*/domain` Browser固有Domainは`frontend/src/domain`
- FrontendのユースケースとPolicyは`frontend/src/usecases`
- View DOM操作と表示変換は`frontend/src/presentation/<feature>`
- Adapterと描画固有の振る舞いは各実装の隣
- Node Agent APIの契約 Port Usecase Handlerは`backend/agent-api/src`の対象ファイルの隣
- FeedbackとAgent TraceはBackendの隣接テストで境界値 schema S3 key prefix 匿名化を確認する

複数層を通すシナリオでも 可能な限り公開Portから実行し 内部実装へ依存しない


### Agent v2

Agent v2のcutover判定は[Agent v2テスト戦略](../docs/operations/testing.md)と
`backend/agent-api/src/composition/agent-v2-acceptance-catalog.ts`を正本にする。

V1 `MultiStepAgentRuntime` のrepair順序、guard名、Prompt本文、内部phase、model callの厳密回数を
V2の互換要件にしない。ユーザー可視の意味がある場合はApplication/Domain invariantとして書き直す。

DOMの読み順・非同期画面更新・MutationObserverを検証するPresentationテストは、
先頭に`// @vitest-environment happy-dom`を指定する。Happy DOMはFrontendの開発依存だけに置き、
手作りのDOMモックでは確認しにくい要素の表示・イベント・属性の退行を再現する。
外部通信や実Mapboxは使用しない。画素配置・実端末の描画速度を保証するブラウザE2Eとは区別する。

## Python

Pythonは`tests/infra`と`tests/repository_tools`の独立した保守tool検証だけに使う
Agent APIとDomainの実装やテストをPythonへ追加しない
各ディレクトリはPython packageとして扱い `python3 -m unittest discover -s tests -v`で再帰実行する

## Fixture

追跡するfixtureの正本 更新方法 派生物は[fixtureガイド](fixtures/README.md)へ記録する
外部サービスから取得した生データ 秘密情報 大容量生成物をfixtureへ追加しない

## 実行

```bash
npm run docs:check
npm run architecture:check
npm test
npm run test:trip:v2:gate
npm run build
python3 -m unittest discover -s tests -v
npm run lambda:check:built
npm run eval:agent:smoke
```

作業中は変更箇所のtargeted testを使い、仕上げの全量確認は原則1回とする。同じrevisionのCI成功結果を
再利用し、変更・失敗・未確認範囲がなければ全量を繰り返さない。
`architecture:check`は`workspace:check`を含む。`test:journey-scenarios`とStrands live-fixturesは`npm test`に
含まれるため追加実行しない。`lambda:check:built`は直前のbuildを検証し、単独の`lambda:check`はbuildも行う。

自動Acceptanceは共有39ファイルを`CI / Test`の`npm test`へ任せ、固有の`test:trip:v2:gate`だけを実行する。
`test:agent:v2`は全Acceptanceを単独調査するときの入口として維持する。手動Workflowでは`full_suite`で
全量再実行を選べる。通常CIはTypeScriptテスト、build/Python、ブラウザ、Terraformを並列実行し、既存`test` checkが
全ジョブの成功を要求する。ブラウザはheadless shellのみをversion別にcacheし、OS依存は毎回確認する。
BrowserはbuildジョブのViewer artifactを受け取り、stream/replayとビルド後の初期表示・12時間ログイン維持を
確認する。ViewerをBrowserジョブで再buildしない。CIのtest tokenを含むartifactはCDでは使用しない。

CutoverのCD入力・破壊的plan拒否・plan-only条件はAWSなしで確認する。

```bash
node --test tools/deployment/*.test.mjs
node --import tsx --test tools/cutover-validation/*.test.mjs tools/cutover-validation/*.test.ts
npm run test:agent-cutover:browser
```

Browser E2Eは`PLAYWRIGHT_MODULE`と必要に応じて`PLAYWRIGHT_EXECUTABLE_PATH`で
repo外のPlaywright/Chromiumを指定する。401/403、空body/不完全JSON、final欠落、stream error、
abort/世代変更を検査し、test HTTP serverの想定外例外もgate失敗として扱う。

## 文書整合の確認

`npm run docs:check`は通常CIで1回実行する。READMEのnpm script、主要Current文書のpreview flag接続口、
撤去済みproduction契約の限定した再流入、全追跡Markdownの相対ファイルリンク（fragmentを除く）、ADR索引を確認する。
Historical節は旧コマンド・gateを保持するため意味検査から除外し、ファイルリンクは検査する。
これは完全な意味整合やリンク先の見出し・外部URLの検証ではない。PR checklistでCurrent / Historicalの判断を補う。
