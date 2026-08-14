# Issue運用

Issueは確定済みの不具合 改善 作業を追跡する
未確定の将来案はIssueへ入れない

## 基本設定

- 担当者は原則としてリポジトリ所有者を登録する
- 種別Labelを1つ付ける
- 対象領域のLabelを1つ以上付ける
- 完了条件が同じまとまりにはMilestoneを付ける
- 複数リポジトリを横断する作業は共通Projectへ追加する
- 実装は1 Issue 1 PRを基本とする

## Label

`type:`は作業の性質を表し 原則1つだけ付ける

- `type: refactoring` 責務分割や内部構造の改善
- `type: reliability` 障害耐性や整合性の改善
- `bug` 利用者に見える不具合
- `enhancement` 挙動や能力の追加
- `documentation` 文書だけの変更

`area:`は影響範囲を表し 複数指定できる

- `area: frontend`
- `area: ai`
- `area: infrastructure`
- `area: data`

## MilestoneとProject

Milestoneは完了条件が明確な成果単位に使う
単なる期限や無期限のバックログ置き場にはしない

Projectは両リポジトリを横断する一覧として使う
Status Priority Repository Milestoneを基本フィールドとする
Project操作にはGitHubトークンの`project`権限が必要になる

## Relationships

- 大きな作業を独立して完了できる単位へ分ける場合は親子Issueを使う
- 着手順が必要な場合はblocked by blockingの依存関係を使う
- 同じ変更を指すだけの場合は本文かコメントで関連Issueをリンクする
- リポジトリをまたぐ移行も可能ならGitHubの親子関係か依存関係で接続する

## Development

- ブランチ名にはIssueの目的が分かる短い名前を使う
- PR本文に`Closes #番号`を記載してDevelopmentへ接続する
- 別リポジトリのIssueは完全なURLでリンクする
- コミットとPRタイトルは日本語にし 種別に合う絵文字を先頭へ付ける
- CIと動作確認が完了してからマージする
- 展開作業が残るIssueはPRマージだけで閉じず 完了確認後に閉じる

## 定期整理

- 担当者 Label MilestoneがないIssueを残さない
- 状況が変わったIssueは本文とRelationshipsを更新する
- 実装済み 重複 不要になったIssueは理由を残して閉じる
- ProjectのStatusとPRのDevelopment表示が一致しているか確認する

