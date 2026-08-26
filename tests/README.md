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
