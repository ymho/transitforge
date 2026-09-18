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
発話regexによる事実抽出、施設・地域別router、固定Tool順序は追加しない。

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
Web全文やProvider rawをそのままClaimへ昇格させない。詳細情報は既存Tool/Place/Proposal表示が担当する。
これは任意のモデル自由文を意味検証できるという保証ではない。通常会話全体の強制JSON化も行わない。

## 検証

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
