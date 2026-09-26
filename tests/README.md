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

Agent v2のcutover判定は[Agent v2テスト戦略](../docs/architecture/agent-v2-testing.md)と
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
npm run architecture:check
npm test
python3 -m unittest discover -s tests -v
npm run lambda:check
npm run test:journey-scenarios
npm run eval:agent:smoke
```

CutoverのCD入力・破壊的plan拒否・plan-only条件はAWSなしで確認する。

```bash
node --test tools/deployment/*.test.mjs
node --import tsx --test tools/cutover-validation/*.test.mjs tools/cutover-validation/*.test.ts
npm run test:agent-cutover:browser
```

Browser E2Eは`PLAYWRIGHT_MODULE`と必要に応じて`PLAYWRIGHT_EXECUTABLE_PATH`で
repo外のPlaywright/Chromiumを指定する。401/403、空body/不完全JSON、final欠落、stream error、
abort/世代変更を検査し、test HTTP serverの想定外例外もgate失敗として扱う。
