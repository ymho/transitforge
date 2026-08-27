# 製品名の移行

製品名はRaiquora（レイクオラ） サブタイトルはAgentic Transit Intelligenceとする
Raiquoraは旧称TransitForgeとして開発されていた

`transitforge`という文字列は用途で分類して扱う

| 分類 | 対応 |
| --- | --- |
| 画面 title loading accessibility label | Raiquoraへ変更 |
| 現在の説明文 ログ表示 | Raiquoraへ変更 |
| LocalStorage key HTTP header API source識別子 | 互換性のため維持 |
| AWS resource Terraform state IAM名 secret path | 置換で再作成や接続断が起きるため維持 |
| GitHub repository data-builder repository | URL互換性のため維持 |
| ADRの過去の判断 | 当時の名称として維持 |

残存箇所は`git grep -niE 'transitforge|TRANSITFORGE'`で監査する
安定識別子の移行は表示名変更とは別のADRと移行期間を設ける
