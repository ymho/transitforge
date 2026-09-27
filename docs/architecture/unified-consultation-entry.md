# 相談の入口と旅程からの継続相談

## 画面契約

主要メニューは「相談・旅程・運行・設定」の4項目。探すを独立した画面・routeにしない。
`#chat`が共通の相談画面で、新規時だけ従来の写真Heroとcomposerを表示する。
利用者が送信すると新しいServer Conversationを作成して通常の相談へ移る。未送信の文字入力やIME変換だけでは画面を切り替えない。
未ログイン送信は入力を保持して認証へ進む。未認証で会話・旅程・運行APIを利用しない。

起動・再読み込み・メニューの相談・新規相談ボタンでは、過去の一般チャットを自動選択しない。
初期画面表示だけで空のServer Conversationを作らない。既存履歴の移行・互換routeは用意しない。

## 旅程の相談

旅程一覧から旅程を開き、旅程画面の「この旅について相談」で同じ相談画面へ移る。Heroは出さない。
相談の「旅程に戻る」で同じTripの画面へ戻す。会話は既存の認証済みTrip参照から取得し、別のTripや直近チャットへfallbackしない。
履歴へ戻る操作でTripの相談を復元する場合も、明示されたTrip参照を再認可・取得する。
URLにTrip本文・owner・認証情報を含めず、現在の画面参照だけをhistory stateに置く。

## 実装境界

Shellはroute/landing/開始中/会話/取得失敗を管理する。Trip workspaceの表示切替はShellへ通知するだけで再取得や新規会話作成を再帰実行しない。
新規相談の作成完了はawaitし、二重送信・別画面へ移動後の遅延完了・認証変更を隔離する。
開始失敗時はHeroの入力を保持する。Trip取得失敗時はHeroへ戻さず対象の再試行を示す。

今回の変更は入口と表示連携。プロフィール3項目化、Trip中心の新保存モデル、履歴付き分岐、目的別Toolは別の改修単位であり、実装済みとはしない。
Agentモデル・prompt・実行上限・保存済みTripへの操作契約・IAMは変更しない。

## 検証

`ai-first-shell.test.ts`で4メニュー、Heroからの送信、IME、認証、二重送信、失敗時の入力保持、遅延完了とTrip参照復元を検証する。
`consultation-navigation.integration.test.ts`で実Trip workspaceとShellを組み、旅程→相談→旅程→新規Heroを確認する。
通常CIのTypeScript全体テスト・architecture・buildおよびV2 Acceptance/Smokeも確認する。
