# ADR 0006: AWSへTerraformでデプロイしAI基盤にAmazon Bedrockを使用する

## ステータス

Accepted

## 背景

TransitForgeをローカル環境だけでなくAWS上へデプロイし、利用者がAI駅員を
使用できるようにしたい。現在のビューワーはViteで生成する静的ファイルと大容量の
列車入力を読み込み、開発サーバーだけがJR西日本の混雑情報キャッシュを提供している。

デプロイ先、インフラ管理方式、AIモデル呼び出し方式を決めないまま個別のAWSリソースを
作ると、再現できない手作業、過剰な権限、APIキーの露出、環境差異が生じやすい。

## 決定

- アプリケーションとAIバックエンドのデプロイ先をAWSとする。
- AWSリソースはTerraformで宣言し、コンソールでの継続的な手作業を前提としない。
- 最初のデプロイでは、Vite成果物と列車入力を非公開S3バケットへ置き、
  CloudFront Origin Access Control経由で配信する。
- 開発環境のCloudFrontにはviewer-requestのCloudFront FunctionでBasic認証を
  適用する。平文パスワードは保存せず、認証情報のSHA-256だけをTerraformへ渡す。
- Terraform stateはアプリケーション用バケットとは別のS3バケットへ保存し、
  バージョニング、暗号化、パブリックアクセス遮断、S3ロックファイルを使用する。
- TerraformのAWS認証情報はコードや変数ファイルへ保存せず、AWS CLIのセッションまたは
  GitHub ActionsのOIDCで取得する。
- AI駅員はAmazon Bedrock Runtimeを使用する。最初のAI接続では、既存の
  検証済みツール境界を維持しやすいConverse APIをLambdaから呼び出す。
- 最初のモデルは東京リージョンのAmazon Nova Liteを使用する。ツール利用に対応し、
  小規模な案内用途でコストを抑えやすく、第三者モデルの利用条件を追加しないためである。
- AI APIはIAM認証付きLambda Function URLとし、Lambda用CloudFront OACからだけ
  呼び出せるようにする。CloudFrontのBasic認証を同じパスにも適用し、API Gatewayは
  独自の認証、利用量プラン、WebSocketが必要になるまで追加しない。
- GitHub ActionsはGitHub OIDCの一時認証情報を使用する。信頼対象は
  このリポジトリの`dev` environmentに限定し、固定アクセスキーを保存しない。
- devデプロイはCIと同じWorkflow内の依存ジョブとし、テスト、ビルド、Terraform検証が
  すべて成功したmainへのpushまたは手動実行だけで開始する。
- LambdaのIAM権限は、選択したBedrockモデルの呼び出しと必要なログ出力に限定する。
- 公開AI APIには、認証、リクエスト上限、スロットリング、予算通知を追加してから
  一般利用を許可する。
- 混雑情報はEventBridge Schedulerから1分間隔でLambdaを起動して取得し、
  最新値とgzip時系列アーカイブをS3へ保存する。ブラウザから上流URLへ直接アクセスしない。

## 代替案

### AWS CDK

既存のTypeScript知識を利用できるが、今回はインフラ差分をHCLのplanとして明示し、
アプリケーションコードとデプロイ定義を分けることを優先した。

### AWSコンソールでの手作業

最初の表示は早いが、設定の再現、レビュー、環境追加、権限監査が難しくなるため採用しない。

### Agents for Amazon BedrockまたはAgentCoreを最初から使用

管理機能は多いが、現在必要なツールは列車検索と可逆的な画面操作に限定されている。
まずLambdaとConverse APIで小さく接続し、実測後に必要性を再評価する。

## 影響

- 静的ビューワーを先にデプロイし、混雑キャッシュとAI APIを独立して追加できる。
- S3、CloudFront、Lambda、Bedrock、EventBridge、IAMの構成をコードレビューできる。
- Terraform state用バケットだけは、アプリケーションstateを利用する前に別途bootstrap
  applyが必要になる。
- CloudFrontの作成・更新には時間がかかり、S3へファイルを配置する処理はTerraformとは
  別のデプロイ手順になる。
- Bedrockのモデル提供リージョン、料金、クォータを選択時と運用中に確認する必要がある。
- 公開AI機能では、推論料金の悪用を防ぐ運用と利用者識別が必要になる。
- 運行情報の長期保存はDynamoDBの列車単位書き込みではなくS3を使用する。
  取得頻度や列車数に比例する書き込みコストを抑え、生レスポンスを再解析可能にするためである。
- Bedrockから日別ピークを低遅延で検索するため、DynamoDBには生データではなく
  1分スナップショット単位の小さな合算サマリーだけを保存する。
