# 一般回答のEvidence binding

## 責務と既存契約

#376はADR 0026 / 0031 / 0044と#375のresponse contractを拡張する。
Evidence、EvidenceClaim、Decision Summaryを正本として使い、新しい永続的Answer/Claimモデルは作らない。

| 回答の由来 | 表示と検証 |
| --- | --- |
| terminal Tool / Proposal / InTripAnswerPlan | 既存Presenterを維持する |
| 取得した外部Evidence・その取得試行を利用する一般回答 | 選択したEvidenceからApplicationがEvidenceClaimと本文を構築する |
| 外部Evidence取得前の挨拶・確認、状態操作後の会話 | 従来の会話契約。無条件にClaimを要求しない |

Runtimeは収集済みtyped facts、実行済みToolのEvidence mapper登録、実在する根拠参照を調べる。
`no_factual_claim_required`という自己申告は、このApplication判定を上書きできない。
取得失敗・空結果でも外部事実取得を試みたturnは、単なる会話へ戻して自由な具体値を表示しない。
利用者の発話regexによるintent router、施設・地域別router、固定Tool順序は追加しない。
根拠なしの初手free-prose出力にも数値+時刻/所要時間等の未結合具体値を拒否する保守的なguardを置く。
これは全文章の意味検証ではない。数値を含む確認は既存native follow-up契約を使う。

## 一般の事実回答

モデルは既存`decision_summary.usedEvidenceIds`で根拠を選び、Applicationが事実本文を描画する。
このlaneではモデルの自由文を表示しない。区間・日付・列車・時刻・所要時間・乗換数は
JourneySearchResponseから明示的に構築したfactsに由来する。
遅延補正を含む検索結果には「検索時点の見込み」と表示し、時刻表上の予定と同一視しない。
列車indexだけにある時刻は、利用日の運行保証としない。

既存EvidenceClaimを使った`{text, claims}`形式も検証できる。ただし任意のモデル文章に
実在IDを貼っただけでは許可しない。提供済みのstatement/kind/evidenceIdsと完全一致し、
本文がそのstatementの連結だけであることを検証する。
文字列照合はモデル文章からの事実抽出ではなく、選択可能なClaim contractの同一性検証である。

空の根拠選択は「その回答を裏付ける根拠なし」としてunknown Claimから表示する。
空選択に添えられた架空の具体値は表示しない。不明なIDはunknownへ握り潰さず拒否する。
本文のClaim欠落・改変・不正参照は#375と同じturn全体1回のrepairを利用する。
不正なassistant応答は次のモデル履歴へ残さない。追加の常時Reflection callはない。

外部情報にprovider/status/鮮度しかない場合、取得したという事実以上を描画しない。
freshな取得資料では、source URLが一致するページ/地点説明から最大1,200文字の抜粋だけをEvidenceへ付ける。
source-explanationは一時的な表示選択で、新しい永続Answer正本ではない。モデルは最大6資料から
各400文字以内の連続抜粋を選び、Applicationが引用元付きのfact Claimへ変換する。
自由な事実書換え・違うページのURL流用・古い資料の現在値化は許可しない。
推薦は実際のProfileの値と引用に結び付いたinference Claimとして事実から分ける。
Web全文やProvider rawをそのままClaimへ昇格させない。詳細情報は既存Tool/Place/Proposal表示が担当する。
これは任意のモデル自由文を意味検証できるという保証ではない。通常会話全体の強制JSON化も行わない。

## 検証

ブラウザのAgent Runtimeは相談実行時に動的importする。追加した検証・描画処理を
初期画面のbundleへ含めず、既存の容量上限を維持する。Backendの実行入口と
モデル・Tool呼出回数は変更しない。

本番ConverseModelProvider → MultiStepAgentRuntime → DefaultAgentResponseGenerator →
validateEvidenceAndClaimsの合成fixtureを使う。Structured generatorだけのテストではない。
正常経路、25分直通という架空数値の誘導、別日付への流用要求を含む。
正常ケースは実際のbound factual Claimが必要。否定ケースはbound factsまたはunknownのみを許可する。
Grounded/Unsupported Claim Rateは実際の非unknown Claimを分母にし、分母0を成功扱いしない。

```bash
AWS_PROFILE=transitforge-dev AWS_REGION=ap-northeast-1 \
  npx tsx tools/run_live_agent_decision_evaluation.ts \
  --suite general-grounding --repetitions 3 --output-dir /tmp/general-grounding
```

出力は合成回答、集計、形式診断とscalar provider diagnosticsだけ。
Provider raw、内部推論、個人の会話・認証情報は保存しない。
既存A〜AU、TTFI/TTFC、モデル、temperature、Tool公開範囲は変更しない。

`tools/run_live_place_grounding.ts`は特徴説明・2候補比較・Profile推薦を同じ本番Runtimeで検証する。
安全性（根拠の結合）と有用性（具体的特徴・両候補・推薦理由）を独立に記録し、unknownだけの回答を成功にしない。
