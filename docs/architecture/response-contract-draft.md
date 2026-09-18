# 一般回答の出力契約repair（#375）

Converse native Tool UseだけをRuntimeが実行する。本文の内部XML/JSONはwire形式違反として表示前に破棄し、引数抽出・Tool routingには使わない。完全なfenced code exampleや普通のJSON説明は対象外。

一般回答・既存InTripAnswerPlan・内部推論のみの応答・不正usedEvidenceIdsは同じturn内のrepair budget（最大1回）を共有する。repair専用の常時model callは追加せず、正常なanswer / ask_user / native Tool Useは従来のcall数を維持する。元のmax call / iteration / timeoutを維持する。

不正Evidence IDは実在確認前に利用しない。不正assistant messageを次のConverseリクエストへ再入力せず、Traceは違反カテゴリ・再試行・結果だけを記録する。repairが再失敗したら安全なfailureとする。

## #376との境界

一般回答のClaim migration、EvidenceClaim binding、generic key/value rendererをこのPRから外した。既存Default/Structured generator、Evidence/Claim validator、System Promptはmainの契約を維持する。既存fixtureの大量書換えやモデル自己申告によるfactual判定は行わない。

#376は独立したOpen Issueとして、deterministic presentation / grounded model answer / non-factual interactionの段階移行を担当する。#375はGroundingの不足を解消したとは主張しない。

## 検証

本番Runtime経路でXML/JSON→native、invalid usedEvidenceIds→bounded repair、異なる違反のbudget共有、payload非露出、正常3経路のcall数不変をテストする。AJ〜AUを含む既存test / Smoke / Fullを維持する。モデル・temperature・threshold・CDは変更しない。
