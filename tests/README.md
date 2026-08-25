# テストガイド

## TypeScript

対象モジュールと同じディレクトリへ`*.test.ts`を置く

- Domainの計算と契約は`src/domain`
- ApplicationのユースケースとPolicyは`src/application`
- UIの状態と表示変換は`src/features/<feature>`
- Adapterと描画固有の振る舞いは各実装の隣

複数層を通すシナリオでも 可能な限り公開Portから実行し 内部実装へ依存しない

## Python

Agent API本体は`services/agent-api`へ置き テストは`tests`からサービスの公開境界を読み込む
テストをサービス内へ入れないことで Lambdaパッケージへの混入を防ぐ

- `agent_api_test_support.py`はAgent API用のfakeと共有fixtureを所有する
- `test_agent_application.py`はAWSイベントに依存しないApplication境界を確認する
- `test_agent_api_*.py`はHTTP境界とAgent API全体の振る舞いを確認する
- 経路と旅行のテストはDomain Tool単位で分ける

## Fixture

追跡するfixtureの正本 更新方法 派生物は[fixtureガイド](fixtures/README.md)へ記録する
外部サービスから取得した生データ 秘密情報 大容量生成物をfixtureへ追加しない

## 実行

```bash
npm run architecture:check
npm test
python3 -m unittest discover -s tests -v
python3 tools/build_lambda_package.py --check-only
npm run eval:agent:smoke
```
