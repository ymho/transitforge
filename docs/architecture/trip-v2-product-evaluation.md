# #758 Trip V2 の製品横断評価

## 合否の境界

候補の有用性、Tripの保存状態、Evidence、部分失敗からの継続、処理時間・Tool/モデル呼出・使用量を別々に記録する。
文言、Tool名の固定順や候補の完全一致を合否条件にしない。owner越境、未承認更新、予約/購入との混同は他の成功で相殺しない。
実行できなかったケースは `not_run` とする。合成モデルや固定DOMを実Bedrock、実Provider、実ブラウザの成功とみなさない。

`tools/trip-v2-product-gate.ts` は以下の各シナリオに、状態、実Bedrock＋固定Provider、実Provider、PCブラウザ、モバイルブラウザ、デプロイ済み版の証跡を要求する。実行記録は会話文やProviderの生データを含めず、case、stage、結果、commit、GitHub Actions run、失敗理由、重大違反、数値だけをJSONへ記す。

| case | 対話と確認する状態 |
| --- | --- |
| `destination-interest` | 出雲大社への興味と言い換え。日程なしでも写真/根拠付き紹介と周辺候補、イベント検索だけ失敗した部分結果 |
| `experience-discovery` | 歴史・食などの体験から違いのある複数候補を比較。人数なしで開始し、選択後に仮旅程 |
| `concrete-itinerary` | 2泊3日、2日目昼食、交通/宿泊の後選択、一部確定、立ち寄り、明示再編集/仮戻し。what-ifと検索の未採用時はTrip不変 |
| `branch-and-reload` | Tripと会話履歴の分岐、片方だけの変更、両方の再読込。元履歴の権限・予約の流用禁止 |
| `partial-failures` | 雨予報/予報期間外/取得失敗、飲食店0件/検索失敗、イベントだけ失敗を区別して対話継続 |
| `condition-and-concurrency` | 空/3項目Profile、メモAI利用OFF、Tripの明示条件優先、訂正・撤回・日程変更、別owner、遅着・再送・CAS競合 |

## 既存の局所証拠と残る実行

- 状態・Repositoryと合成SDKの局所試験: `backend/agent-api/src/composition/strands-place-cards-acceptance.test.ts` は候補カード、履歴保存、再送、owner越境を確認する。`backend/agent-api/src/composition/epic-537-product-e2e.test.ts` は候補採用、再読込、局所変更を確認する。`backend/agent-api/src/usecases/agent/trip-gap-place-tool.test.ts` と `trip-gap-restaurant-tool.test.ts` は天気の部分失敗を扱う。これらは実Providerや実画面の証拠ではない。
- 実Bedrock＋固定Provider: `.github/workflows/strands-v2-live.yml` の `trip-v2-product` は `strands-trip-product-live.test.ts` の3種の入口を実Strands/Bedrock、隔離したTrip、固定Providerで確認する opt-in 経路。1回につき最大3ケース×8モデル呼出、各turn 60秒で実行する。分岐・変更・部分失敗を含む残りのcaseや各caseの縦断完了は別途記録が必要で、単発Runを六つの縦断caseの合格へ読み替えない。
- 実Provider: 本番と同じ接続を使って観光/写真/飲食/天気を各caseで取得し、Evidenceの出典と時刻、取得不可の状態を記録する。写真の表示確認はProvider応答とは別に画面で行う。
- PC/モバイル: ログインした実ブラウザで候補カードと写真、旅程/相談の移動、保存・再読込・分岐・差分確認を操作して記録する。preview/固定DOMは代用不可。
- デプロイ: mainのCI、Agent Acceptance、CDのSHAとRunを照合する。CI成功だけでブラウザ側の再読込成功を断定しない。

`npm run eval:trip:v2 -- /tmp/trip-v2-observations.json /tmp/trip-v2-report.json --require-all` は記録漏れ・失敗を非ゼロ終了にする。入力は配列で、要素例は `{ "scenario": "partial-failures", "stage": "real-provider", "status": "not_run", "commit": "<40桁SHA>", "reasons": ["weather_failure_not_exercised"] }`。`passed` には実行したGitHub Actions Run URLを必須とする。集計結果の `missing` と `failed` を残件としてIssueへ記録する。

現段階では全caseの実Provider・両ブラウザ実行と実Bedrock縦断を未完了として扱う。#751/#758のクローズは各段階の記録と実際の不具合の解消後に判断する。
