# 会話履歴と出力予算の監査（2026-09-08）

## 調査範囲と根拠

非公開S3の9月のFeedback 31件と9月7日のmodel-call trace 79件をローカルで調査した。
これらは独立した31セッションや79回の旅行相談を意味しない。同一会話内の複数呼び出しを含む。
生会話、個人情報、request ID、providerRequest、AWSアカウント情報はこの文書へ転記しない。

- 79呼び出し中2件が`max_tokens`で終了した。生成上限は500 tokensだった
- 12件で`conversation.relevantMessages`に入れた履歴JSONが500文字で切れ、JSONとして成立していなかった
- 26件でContextの圧縮が発生した。旧core形式はconversation自体を含めなかった
- 調査対象にはProfileフィールドが存在した。単に「プロフィールを送っていない」とは説明できない
- Tool結果には既出質問の拒否、検索入力不足、必要なWeb本文未取得などもあった。これらは履歴欠損だけで説明できるとは限らない

本番モデルは会話用`amazon.nova-lite-v1:0`と構造化判断用`jp.amazon.nova-2-lite-v1:0`だった。
モデル比較の前に、既知の履歴を欠落させる入力処理と、短い出力枠を修正する。

## 変更と責務

履歴を最大12件・各1,600文字のrole/text配列へ変更した。旧JSON文字列形式も切断前に復元する。
Context JSONの上限は3,600から24,000文字へ拡張し、圧縮時も直近の会話を残す。
APIのtext上限を4,000から32,000文字へ合わせ、HTTP bodyの2 MiB上限は維持する。
履歴全量を無制限に送るものではなく、古い文脈は既存のsummary、TripContext等も使う。

Bedrockの生成上限を500から4,096 tokensへ変更する。Decision Summaryと回答の両方に余裕を確保するが、
常に4,096 tokensを生成する指定ではない。比較用Adapterオプションは1〜5,000を検証する。
[Novaのリクエスト仕様](https://docs.aws.amazon.com/nova/latest/userguide/complete-request-schema.html)と
[Nova 2の仕様](https://docs.aws.amazon.com/nova/latest/nova2-userguide/request-response-schema.html)の範囲内で設定する。

Issue #306とADR 0044/0048の責務分担は維持する。新しい発話routerや固定Plannerは追加しない。
意味解釈とTool選択は引き続きBedrock、Evidence生成・検証、Viewer policy、実行回数とtimeoutはコードが担う。
既出質問の安全弁は構造化履歴と旧履歴の両方で検証する。モデルやSystem Promptは変更しない。

## 評価

Live Evalは架空の入力と固定Tool結果を使い、Bedrockの意思決定を実測する。
2回のTool実行後に最終回答できるよう、Eval専用budgetを2から3 model callsへ修正した。
従来の2回では2つ目のToolを期待するケースでも最終回答を要求してしまっていた。本番budgetは変更しない。
長い比較会話の後に「2番目」を参照するケースを追加した。同じ修正済み15件で比較した。

| 実験 | 結果 | 反復 |
| --- | --- | --- |
| structured-decision routing・500 tokens | 14/15 | 1回 |
| 同routing・4,096 tokens | 15/15 | 1回 |
| 長い会話後の候補参照・4,096 tokens | 3/3 | 同一ケース3回 |

15件単回比較では両設定ともmodel calls 18、tool calls 16だった。Trace集計は500 tokens設定で
入力63,446 / 出力1,971 tokens、モデルlatency合計14,093 ms、4,096設定で
入力63,443 / 出力1,715 tokens、同12,955 msだった。これは単回測定であり、latency短縮や費用削減の保証ではない。

単回の15/15は安定性や改善の因果関係を証明しない。このLive EvalではGrounded Claim Rateと
Unsupported Claim RateがN/Aであり、文章の自然さ・実APIを含む完遂率も保証しない。
決定論的Smoke Evalと既存テストは別途維持し、自然さは展開後の複数ターン会話で確認する。
実会話providerRequestのBedrock再送は自動承認審査で拒否されたため実施していない。
結果と生データはGit管理外のローカル作業領域に保存した。

## 残る確認

- 同一の複数ターン会話で、既知条件の聞き直し、代名詞・候補番号・帰路の参照、旅程変更の継続性を確認する
- 実APIの欠損や入力エラーを受けた再計画と、利用者への説明を評価する
- model/tool call数、入出力tokens、latency、timeout率を展開前後で測る。入力枠・出力枠の拡大は費用やlatencyを増やし得る
- 入力欠損を直した条件でモデル比較する。今回の結果だけでモデルの能力不足を否定しない
