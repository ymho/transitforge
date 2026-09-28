# 目的別旅行Tool

関連: #751 / #755 / ADR 0096

## モデルが選ぶ3能力

旅行相談の入口を固定文言・正規表現・Application分類器へ戻さない。Strandsへ次の能力を同時に公開し、会話とTripの現在条件を見たモデルが選ぶ。

| Tool | 用途 | 副作用 |
| --- | --- | --- |
| `explore_destination` | 特定場所の魅力、楽しみ方、写真、周辺候補 | read |
| `discover_destinations` | 体験価値から比較可能な複数候補を発見 | read |
| `draft_itinerary` | 既知条件から1件以上の仮旅程を保持 | proposal。Tripへは未採用 |

`explore_destination`と`discover_destinations`は既存のWeb/Knowledge Base discovery、上位ページの安全な読込、地点・写真のsource bindingをApplication内部で合成する。検索snippetや未解決地点を表示候補へ昇格しない。低水準Toolは既存Runtimeとの移行互換として残るが、Agent v2 promptは同じ目的での反復を禁止する。

`draft_itinerary`は既存のowner-scoped candidate retentionへ接続する。ServerがCandidateSet ID、Trip revision binding、期限を発行し、モデルはそれらを作らない。仮旅程の保持はTrip採用ではなく、採用・変更は後続の明示操作で行う。時刻、料金、営業、宿泊等の未確認値は`unknowns`へ残す。

## 取得結果の区別

目的別readは`outcome.status`を返す。

- `complete`: 必要な数の読了資料を確認し、地点・写真照合にも失敗していない。
- `partial`: 一部の候補や資料は使えるが、読込、地点/写真照合、複数候補数等に不足がある。成功結果を捨てない。
- `no_candidates`: 検索自体は完了したが候補が0件だった。
- `failed`: 検索を完了できず、候補が0件だった。候補が存在しない証明には使わない。

`completedScopes`、`failedScopes`、`reasonCodes`をモデルへ返し、0件と障害を自然文だけで推測させない。Provider例外も`failed`として返し、Tool errorだけへ潰さない。明示的な入力不正だけは`invalid_input`で拒否する。

## 写真の公開境界

`PublicPlacePresentation`の写真は任意である。Applicationがcurrentな`place_description` Evidenceから、HTTPS画像URL、写真ページ、attribution、任意licenseを投影する。モデルがカードpayloadや写真URLを提出する経路はない。写真がなくても候補カードは表示でき、placeholderや別ProviderへのBrowser fallbackは作らない。

Frontendは保存済みsnapshotをlive SSEと履歴で同じように描画し、写真をlazy loadして出典へリンクする。危険なURL、資格情報付きURL、秘密を示すquery parameter、余分なfieldはtransport/storage parserで拒否する。

## 検証境界

決定論的テストでは、3 Toolの公開、typed facet、complete/partial/no_candidates/failed、内部ページ読込と写真照合、V2 proposalの明示opt-in、CandidateSet保持、写真のApplication投影、SSE/history共通parserを確認する。実Bedrockによる3発話の意味選択と実Provider/画面E2Eは#758で扱う。
