# 公式アカウントのしおり公開と取り込み (#821)

公式ユーザーはサーバ設定`OFFICIAL_PUBLISHER_SUBJECTS`のCognito subject allowlistで判定する。
表示名・メール・Trip上のフラグ・クライアントの申告を権限の根拠にしない。
Terraform変数`official_publisher_subjects`は既定で空。運用者が公式アカウントのsubjectを設定してデプロイする。
専用管理画面や固定seedは作らず、公式アカウントも通常の画面で自分の旅程を編集する。

## 公開

公式アカウントの所有Tripの「共有」内に「公式しおりとして公開・更新」を表示する。
公開確認後、サーバが現行Tripのrevisionと本人所有を検証し、公開用snapshotを生成する。
公開版は編集原本と独立し、原本の編集を自動反映せず再公開時にversionを増やす。
取り下げは同じ公式所有者だけが行える。allowlistから除いたアカウントの公開版も取得・取り込み対象から外す。

公開用snapshotはタイトル・エリア・活動名・場所名・相対的な日順を残す。
日付・固定時刻・人数・制約・会話・採用/実施状態・価格・出典/Provider選択・予約情報をコピーしない。
宿は未選択の「宿泊先を選ぶ」、移動は「移動を検索する」とし、過去の空室/列車を再利用しない。
写真を扱わない。編集者はタイトル・活動名・場所名の公開可否と著作権を確認して公開する。
公開版はトップページの「公式しおり」に表示され、閲覧専用。認証済みの場合に一覧を自動取得する。未ログインではログインの入口を表示し、公開APIや匿名閲覧は提供しない。旅程ページには「あなたの旅」「共有中の旅」だけを残す。

既存Trip DynamoDB tableの`OFFICIAL#CATALOG / GUIDE#tripId`に`guide{id,version,publishedAt,trip}`と
内部publisher/activeを保存する。publisher subjectはレスポンスへ返さない。
公開transactionは原本が未archiveかつ読んだ内容と同じであることと、前公開版のCASを検証する。
一覧はprefix Queryの20件/page、非公開のpageでもcursorを残す。Scan/backfillは行わない。

## 自分の旅へ取り込む

トップページの公式しおりを開き、プレビューで「出発日（日本時間）」「大人」「子ども」を確認して「このしおりで旅を作る」。
各相対日に連続したAsia/Tokyoの日付を割り当てる。時刻/交通/宿/子どもの年齢は未確定で、あとから相談して具体化する。
新UUIDの本人所有Tripを作り、Tripに`officialOrigin{guideId,version}`を保存する。
詳細では「公式しおりから作成」と示し、公式原本として表示しない。通常の編集でも由来を保持する。

取り込みtransactionは読み取った公開版のpayloadをfenceし、本人Trip・取り込みreceipt・TripChanged outboxを
一括作成する。取り下げ/再公開と競合した場合は何も作らず拒否する。
新Trip UUIDを再試行keyとし、receiptは元版/出発日/人数の一致を確認する。
response lostや詳細遷移失敗の再試行は既存Tripを返し、別入力/既存IDを上書きしない。
クライアントが通常create APIへ由来を偽装して送ることは拒否する。
コピー後の編集/共有/公式取り下げは他方のTripを変更しない。

## 検証

Domainテストで公開時の除外、日付/人数の検証、年をまたぐ連続日程、由来の維持を確認する。
Application/SDK transaction fixtureで公式権限、本人所有、改訂/取り下げ、設定解除、
取り込みcommit race、response lost、入力違いの再試行とoutbox一回作成を確認する。
Presentationテストでカテゴリ/role、遅延レスポンスのaccount fence、spinner/再試行、取り込み/遷移を確認する。
fixture検証はlive DynamoDBの代替ではない。LLM Prompt/Toolやpaid Live Evalは変更しない。

公式しおり自体に具体的な日付・人数は不要。公開時に除外し、相対日順だけを保持する。ただし、現在の取り込みAPIは出発日・人数を必須とするため、自分の旅程に採用する時点で入力する。未定のまま取り込む機能は現在提供しない。
