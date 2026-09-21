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
source-explanationは一時的な表示選択で、新しい永続Answer正本ではない。前後に表示ラベルやcode fenceがあっても、単一のJSON payloadだけを検証して描画し、周囲の自由文は破棄する。未知Evidenceや改変した抜粋を許可するものではない。モデルは最大6資料から
各400文字以内の連続抜粋を選び、Applicationが引用元付きのfact Claimへ変換する。
自由な事実書換え・違うページのURL流用・古い資料の現在値化は許可しない。
推薦は実際のProfileの値と引用に結び付いたinference Claimとして事実から分ける。
Web全文やProvider rawをそのままClaimへ昇格させない。詳細情報は既存Tool/Place/Proposal表示が担当する。
これは任意のモデル自由文を意味検証できるという保証ではない。通常会話全体の強制JSON化も行わない。

## 旅行提案の表示

旅行案を求められた一般回答では、`travel-plan`を`source-explanation`と同じ一時的な表示選択として使う。
新しいPlannerや永続Tripを作らず、モデルは最大3候補について、実在する資料Evidence、資料中の連続抜粋、
日ごとの定型activity、AI概算、取得済み写真Evidenceを選択する。Applicationは次を検証して本文を構築する。

- 候補説明はfreshな資料の連続抜粋に限り、出典を付ける。
- 行程は時刻・所要時間・営業を含まない定型activityから構成し、「提案」と明示する。
- 概算は交通・宿泊・観光・食事の4項目、利用者全員・旅行全体の整数円とし、人数、泊数、起点交通、宿の水準を前提表示する。合計はApplicationが計算し、予約価格・支払額・価格保証と区別する。
- 写真はHTTPS、hotlink可、attributionと掲載元があるものだけを使う。資料候補と同一Evidence、またはProviderが保持するsource URL bindingで結び付く写真に限る。

写真Markdownの表示用titleはApplication専用とし、モデルの自由文に同じmarkerがあれば拒否する。Frontendはこのmarkerと
HTTPSの両方を満たす画像だけを`img`として描画し、通常のMarkdown画像は従来どおりリンクに落とす。
これにより、未検証URLの自動読込を許さず、会話履歴からの再表示でも同じ安全境界を維持する。

## 検証

production相談はServer Agent Runtimeで実行する。Browser Runtimeとその動的importは
#481 Batch 1で撤去済みであり、追加した検証・描画処理をFrontendから起動しない。

本番ConverseModelProvider → MultiStepAgentRuntime → DefaultAgentResponseGenerator →
validateEvidenceAndClaimsの合成fixtureを使う。Structured generatorだけのテストではない。
正常経路、25分直通という架空数値の誘導、別日付への流用要求を含む。
正常ケースは実際のbound factual Claimが必要。否定ケースはbound factsまたはunknownのみを許可する。
Grounded/Unsupported Claim Rateは実際の非unknown Claimを分母にし、分母0を成功扱いしない。

旧Browser decision Live Eval harnessは#481 Batch 1で撤去した。
Provider raw、内部推論、個人の会話・認証情報は保存しない。

`tools/run_live_place_grounding.ts`はBackendのConversationModelProviderと共有Runtimeを使い、
特徴説明・2候補比較・Profile推薦を検証する。
安全性（根拠の結合）と有用性（具体的特徴・両候補・推薦理由）を独立に記録し、unknownだけの回答を成功にしない。
