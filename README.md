# TransitForge

TransitForge is a greenfield personal project for visualising planned train
movements from prepared full-network route and timetable data.

## Status

Product brief, initial viewer input contract, and a reproducible input
measurement tool are defined.

The viewer will be a web-based 3D application using Mapbox. The initial viewer
uses Vite and TypeScript without a UI framework, and displays all routes plus
the planned positions of active trains at a selected time. Three.js is currently
used for a Mapbox integration prototype; its adoption as the train renderer is
not decided yet. The detailed architecture, cloud platform, and deployment model
have not been selected yet.

## Goals

- Define the problem before selecting technology.
- Build the smallest useful end-to-end slice first.
- Keep domain logic independent from presentation and infrastructure.
- Make important decisions explicit and reviewable.
- Add automated checks alongside implementation.
- Prefer reproducible data processing over manual correction.

## Repository structure

```text
.
├── .github/
│   └── pull_request_template.md
├── docs/
│   ├── architecture/
│   │   ├── mapbox-three-train-rendering.md
│   │   └── principles.md
│   ├── decisions/
│   │   ├── 0000-template.md
│   │   ├── 0001-use-mapbox-for-web-3d-visualisation.md
│   │   ├── 0002-use-vite-and-typescript-for-the-initial-web-viewer.md
│   │   ├── 0003-serve-local-viewer-input-in-development.md
│   │   └── README.md
│   ├── data/
│   │   └── viewer-input.md
│   └── product-brief.md
├── tests/
│   └── test_measure_viewer_input.py
├── src/
│   ├── main.ts
│   └── style.css
├── tools/
│   └── measure_viewer_input.py
├── .env.example
├── .nvmrc
├── index.html
├── package.json
├── tsconfig.json
├── .editorconfig
├── .gitattributes
├── .gitignore
├── AGENTS.md
├── CHANGELOG.md
├── CONTRIBUTING.md
└── README.md
```

## First steps

1. Measure the actual full-size input files.
2. Define the minimum complete viewer and performance targets.
3. Compare and select the technical stack.
4. Record the initial technology decisions under `docs/decisions/`.
5. Create the development environment.
6. Add build, test, lint, and CI commands to this README.

## Development commands

### Mapbox access token

Copy `.env.example` to `.env.local`, then set `VITE_MAPBOX_ACCESS_TOKEN` to a
Mapbox public access token. Keep `.env.local` local and do not commit it.

```bash
cp .env.example .env.local
```

The token is available to browser code, so it must be a public token and must
not grant access beyond the viewer's needs.

### Initial 3D map

Use the Node.js version recorded in `.nvmrc`, install dependencies, and start
the local development server:

```bash
nvm use
npm install
npm run dev
```

開発サーバーは、JR西日本の列車混雑情報を同一オリジンの
`/api/westjr/trainmonitorinfo.json` で提供します。上流へのアクセスは
サーバー全体で5分間キャッシュされ、クライアントは1分間隔で更新します。
非表示タブでは更新せず、失敗後は15分待って再試行します。本番環境を追加する
場合は、同等以上の共有キャッシュを持つプロキシが必要です。

AWS開発環境ではEventBridge SchedulerとLambdaが上流を1分に1回取得し、
最新値を同じパスでCloudFront配信します。各取得結果はgzip圧縮した時系列データとして
非公開S3にも保存します。同時にDynamoDBへ毎分の合算サマリーを保存し、
AI運行観察員から「今日の混雑のピークは？」などの日別分析に利用できます。

Create a production build with type checking:

```bash
npm run build
```

Run the TypeScript tests:

```bash
npm test
```

列車のMapbox・Three.js統合と、描画精度を保つためのローカル座標方式は
[`docs/architecture/mapbox-three-train-rendering.md`](docs/architecture/mapbox-three-train-rendering.md)
を参照してください。

AI運行観察員のユーザーインターフェース、許可する画面操作、今後のAPI接続境界は
[`docs/architecture/ai-operations-guide.md`](docs/architecture/ai-operations-guide.md)
を参照してください。

### AWS deployment

AWSへの初期デプロイはTerraformで管理する。最初の段階では、非公開S3バケットと
CloudFront Origin Access Controlで静的ビューワーを配信する。

1. [`infra/terraform/bootstrap`](infra/terraform/bootstrap) でstate用S3バケットを作成する。
2. [`infra/terraform/environments/dev`](infra/terraform/environments/dev) で開発環境を作成する。
3. Vite成果物とローカル生成済みの `viewer-input/` をアプリケーション用S3へ配置する。

AI運行観察員は、CloudFrontからのみ呼べるLambda Function URLとAmazon Bedrock
Nova Liteを使用する。列車検索は大容量入力を持つブラウザ側で実行し、Bedrockには
最大5件の候補だけを返す。混雑履歴はDynamoDBの毎分サマリーから検索し、生S3
アーカイブ全体をモデルへ送らない。AWS認証情報やMapboxトークンをTerraformファイル、
tfvars、stateへ保存しない。

GitHub ActionsはPull Requestとmainへのpushでテスト・ビルド・Terraform検証を行う。
mainへのpush後はGitHub OIDCの一時認証情報でdev環境のTerraformをapplyし、
Vite成果物をS3へ同期してCloudFrontを無効化する。固定AWSアクセスキーは使用しない。

### Input measurement

Measure full-size viewer input files and write the JSON report to standard
output:

```bash
python3 tools/measure_viewer_input.py \
  viewer-input/train_index.json \
  viewer-input/path_catalog.json
```

Run the measurement tool tests:

```bash
python3 -m unittest discover -s tests -v
```

### Station-to-line catalog

Generate the compact local station-to-line catalog from the National Land
Numerical Information station GeoJSON. The generated file stays under the
Git-ignored `viewer-input/` directory.

```bash
python3 tools/build_station_line_catalog.py \
  /path/to/N02-25_Station.geojson \
  viewer-input/station_line_catalog.json
```

The generator limits the catalog to the railway operators used by the current
train input, normalises known operator-name variants, and does not modify the
source GeoJSON.

Formatting and lint commands are not defined yet.

## License

No license has been selected. Do not assume permission for external reuse or
distribution until a license is added.
