# Raiquora

Agentic Transit Intelligence

実時刻表をもとに列車の計画位置を3D地図へ表示し、旅行の相談から旅程を組み立てる個人開発プロジェクト。

## Current

- Mapbox / Three.jsの列車表示と、取得できた遅延・混雑の運行情報。
- Server Agentによる旅行相談、日付別時刻表の経路検索、観光・宿泊候補の比較。
- 保存した旅程の一覧と日別タイムライン。検索済み経路・宿泊先の明示採用、予定の編集・経路全体の選び直し。
- 旅程ヘッダーからの共有・共同編集、個人/共有/公式しおりの一覧。公式アカウントの公開と、日付・人数を指定した[公式しおりの取り込み](docs/architecture/official-guides.md)。
- 任意のプロフィール「普段の出発地／好きなこと／いつも配慮してほしいこと」。今回の人数・日程・予算は各旅で扱う。

Homeの静的な入口以外はCognitoログインが必要。自己登録は無効で、新規アカウントは管理者が作成する。
相談は認証済み`/api/agent-stream`のStrands v2専用Server Agentを使う。
Conversation / Profile V3 / Trip V2の永続正本はServer API・DynamoDBであり、Browserに保存・復元・実行のfallbackはない。
端末の経路検索設定と表示状態は[標準データモデル](docs/architecture/domain-model.md)を参照する。

## ローカル起動

Node.jsは[.nvmrc](.nvmrc)、依存管理はrootのnpm workspaceと`package-lock.json`を正とする。

```bash
nvm use
npm ci
cp .env.example .env.local
npm run dev
```

入口は`http://localhost:5173`。地図表示には`.env.local`のMapbox公開トークンとdata-builder生成の
`viewer-input/train_index.json` / `viewer-input/path_catalog.json`が必要。
混雑・遅延が未取得または古い場合は計画位置を表示し、運行情報未取得を明示する。
通常の相談・保存には認証設定とBackendが必要。公開設定の取得は[dev環境](infra/terraform/environments/dev/README.md)、
合成データでのUI確認は[workspaceのDEV preview](docs/architecture/trip-workspace.md#開発確認)を参照する。

## 通常の確認

```bash
npm run docs:check
npm run architecture:check
npm run build
```

作業中は対象のテストを使い、PRの全量検証は同じrevisionのCI結果を再利用する。
全量・Acceptance・有料Liveの使い分けは[テストガイド](tests/README.md)を参照する。

## 詳細への入口

- [プロダクト概要](docs/product-brief.md): 現在の利用者価値と対象外。
- [モジュール境界](docs/architecture/module-boundaries.md) / [Domainの所有権](docs/architecture/domain-ownership.md): コードの配置と依存方向。
- [標準データモデル](docs/architecture/domain-model.md) / [プロフィール](docs/architecture/travel-profile.md) / [Trip workspace](docs/architecture/trip-workspace.md): 正本・保存先・画面。
- [共通認証境界](docs/architecture/authentication-boundary.md) / [Server Agent](docs/architecture/server-agent-cutover.md): 公開経路と実行責務。
- [Viewer入力](docs/data/viewer-input.md) / [Infrastructure](infra/README.md): データと運用。
- [ADR索引](docs/decisions/README.md): 当時の判断履歴。Historical節のコマンドやgateを現行手順として使わない。

製品表示名は現行UIのRaiquoraに合わせる。`ymho/transitforge`、`@raiquora/*`、AWS resource名・API path・保存キーは互換性のため維持する。
ライセンス未設定。外部データ・生成物・秘密値をGitへ追加しない。
