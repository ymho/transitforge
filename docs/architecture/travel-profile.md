# 旅行プロフィールの互換編集（#457）

## 正本・保存・未設定

既存UserProfile v2、`transitforge.travel-profile.v2`、既存Repositoryを再利用する。
home、companions、travelStyle、preferences、transportに対応する1つのフォームとし、モックの別Profileを作らない。
未設定数値/車利用はfield省略とする。0やfalse、標準ペースへ変換しない。legacy null移動時間も維持する。
旧v2の値は読込/編集/保存後もそのままで、schema移行・保存キー変更・原本削除はない。

各スライダーは0〜1を直接扱う。無操作時は.123等の旧重みも丸めない。
未設定のスライダーは無効で、利用者が「設定」を選んだ時だけ値を保存する。
未設定fieldを別の既定値で上書きせず、表示しない子どもの年代も保持する。

## 編集と失敗

起動時にmodalを自動表示しない。未登録で相談可能。
編集draftはclone、明示保存だけsetItemする。取消/Escape/ページ離脱時は未保存変更を案内する。
削除は再確認する。quota・アクセス拒否を成功と表示しない。破損した保存原本は自動上書きしない。
無効データは明示削除後に新規登録可能である。

## Agent / Trip / privacy

普段の人数はcompanions.usualPartySize、優先移動手段はtransport.preferredMode。
AgentへはusualPartySizeHint/preferredTransportHintとしてbounded projectionを渡す。
未設定ペース/車利用はContextでも未設定のまま。今回のTripRequest/明示入力を優先し、Profile保存でTrip A/Bを変更しない。
予約の人数、今回のparty、hard constraintへ自動転記しない。

notes.budget/lodging/food/avoidancesは各500文字以下の端末メモ。HTMLとして実行しない。
生Profile・自由記述をTraceへ出さないためメモはAgentへ自動転送しない。フォームでもその制限を明示する。
Profile編集による端末間同期はない。#451の認証切替では端末Profileを別principalへ暗黙移譲せず、明示的な取込/継続確認を所有する。
現時点で公開認証/保存gateは変更しない。

## Wave接続

#453のマイページは保存済み要約と既存toggleを使用する。編集/取消/削除はこの同じ機能へ接続する。
#456は今回条件との明示的な適用を担当する。デザインモックの固定人数/予算は入力初期値にしない。
