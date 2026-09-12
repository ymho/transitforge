# Trip V2 Activity (#410)

正本は#382/#415、[ADR 0052](../decisions/0052-establish-trip-v2-contract-and-migration.md)。
#426をmainへマージした`d924d44`を基準に、同じTrip/items/Patch/converterを拡張した。
新しいActivity aggregate、Repository、会話進行state、Plannerは作らない。

## 現行 → 今回 → 後続

| 現行表現 | 今回の扱い / 後続 |
| --- | --- |
| `SightseeingPlanItem` | legacy reader/writerは維持。同じconverterのPlace/schedule mappingをActivityへ接続 |
| `ExperienceOffering` / `TravelCandidate.experiences` | `travel-candidate.ts`の比較・費用集計用候補。実Providerの体験検索producerは未接続。OfferingをTripへ入れず、採用境界で許諾済み名称・日付・解決済み会場を投影 |
| `RestaurantCandidate` / `search_restaurants` | Provider内ID、genre、予算、営業、画像、Mapbox照合IDを持つruntime結果。新しい採用Portはこの既存型を解決しfoodへ投影。genreの値はコピーしない |
| place search / media | 場所の検索・matching・重複排除は#377のまま。写真・rating・営業時間・詳細説明はruntimeでありActivityへコピーしない |
| event / Web research | `ExternalSourceEvidence.kind=event`とWeb本文があるが、一般イベントOffering/予約APIはない。既存event EvidenceをPlace出所として検証可能にする。イベント予定自体はmanual Activityで保持可能 |
| Trip V2 transport/stay | 同じunionへactivityを追加。rail計画/観測分離と宿の未選択境界は変更しない |
| #384 Runtime / #391観測 | 同じProposal登録・応答・質問併記を拡張。Activity add/replaceの公開previewをitineraryとして計測 |

## Domain契約とadd

`ActivityItineraryItem`は既存baseのid/title/scheduleと、type=activity、category、任意placeだけを持つ。
categoryはsightseeing / food / experience / event / shopping / relaxation / free-time / other。
Domainの表示分類であってProviderのcategory codeでもTool選択規則でもない。
empty title/ID、未知category/field、不正Place/scheduleを拒否する。

場所なし自由時間をそのまま保持する。「未定」というPlaceを生成しない。
fixed/window/day/unscheduledは#386の型とvalidationだけを使い、日付不明を今日、
午後を14時固定、終了不明を0分としない。予約成立や訪問済みを推測しない。
placeは#414のPlaceSnapshotのみ。Provider rawや候補配列を入れるfieldはない。

PlanAssumptionのitem参照は種別に対して検証する。Activityはschedule/placeのみ許可し、
selection参照は場所の有無や仮定の確認状態にかかわらず拒否する。
却下したplace仮定はplace未設定、schedule仮定はunscheduledの場合のみ保持できる。
stay/transportの既存selection仮定の意味は変更しない。

`TripPatch`へ`{type: add, item, afterId?}`を追加した。
省略は末尾、指定は存在するIDの直後。空文字/未知ID/自己参照/重複IDは拒否する。
同じ列の先行addを後続add/replaceが参照できる。ローカルの作業配列で全件と最終Tripを
検証してからcloneを返し、不正列では元Tripを変更しない。replaceは既存同種itemのみでupsertしない。
revision/updatedAtはそのまま。remove/move、CAS、mutationId、冪等性、writerは#389の責務である。

## Application採用境界

`usecases/trip-plan/propose-trip-activity.ts`を入口とする。

1. `proposeManualActivity`: 利用者の予定意図とscheduleからadd/replace Proposalを作る。
   外部Evidence/ref付きPlaceをmanualと偽装できない。モデル向けToolではPlace入力自体を公開しない。
2. `proposeActivitySelection`: opaqueな候補IDを`ActivitySelectionPort`で解決する。
   このPortは短命の検索結果と信頼した検証metadataを返すApplication境界で、Trip Repositoryではない。
3. ちょうど1件、同じcandidate/Trip/task、期限、Provider内identity、sourceId、取得日時、
   confidence=observed、Place出所binding、名称/日付とPlace各fieldの保持許諾を確認する。
   lookup失敗/曖昧/期限切れ/unknown permissionはProposalを返さない。
4. restaurantはfood、ExperienceOfferingはexperienceへ明示mappingする。ジャンル文字列のrouterはない。
   restaurantの日時指定なしはunscheduled。体験日は許諾済みstartDateをdayへ写し、
   明示scheduleが提供日と異なる場合は拒否する。体験IDは会場IDに流用しない。
   体験の会場Placeはresolverが別途解決したものを使い、会場/出所を検証できない候補は採用を保留する。
5. titleと許可済みPlaceを明示構築し、place.sourcesにdurable sourceId/Provider/取得日時を保持する。
   raw、current price、空席、review、画像、bookingUrlはコピーしない。価格Observationは#412、予約は#398。
6. add/replace + 既存planning patchを同じProposalとして検証する。既存draft/refinementの編集は
   refinement、それ以外はdraftの案となる。lifecycleを変えず、元Tripは不変。

`ResolvedActivityCandidate`はPortの一時的lookup metadataであり、Providerレスポンスの保存型ではない。
retention/source/Provider identityをモデル・UIから受け取らない。
Mapbox temporary結果へ新しい保持許諾を発行しない。他Providerも名前だけでpermittedにしない。
synthetic fixtureのgrantは実サービスの利用許諾を意味しない。
実Providerごとの保持許諾・解決済み会場を供給するAdapterがない場合、その候補のV2採用は未有効である。

## 単一legacy converter

既存`convertLegacyTripPlan`の`placeMappings`とschedule mappingを再利用する。相対順序とitem IDを維持する。

- 保持可能Placeと有効な日付 → sightseeing Activity + 同じPlace/schedule。日付なしはunscheduled。
- 保持許諾不明/不正Place → placeなし + 警告。制限されたProvider名称をtitleへ迂回コピーせず、
  「観光（場所の移行未完了）」という移行表示を使う。これは架空のPlaceではない。
- 不正coordinate/日付/保持できない既知field/未知追加field → 変換可能部分のみ、警告とdeferred ID維持。
- **Placeが得られ、item単位の警告がない場合のみdeferredから外す。** 部分変換を移行完了にしない。
- placeMappingsは診断projectionとして互換維持するだけで、第2の永続Place正本にはしない。
- input不変・決定性・原本保持必須を維持する。migration時刻を観測/予定/採用時刻へ偽装しない。

## Agent / preview / metrics

`propose_manual_activity`と`propose_activity_selection`を既存registryへ追加する。
V2 getCurrentTripがある場合のみ公開し、後者は信頼した候補Portも必要とする。
state/categoryを能力振分や固定質問順に使わない。モデルは追加・置換・質問・Toolを選ぶ。
同一実行内の後続Toolは、それまでの検証済みProposal previewを参照できる。
新しい永続stateではなく、最終Proposalを元Tripへ原子的に検証するための作業値である。

仮置きは#387のPlanAssumption/model/unconfirmedを利用し、既存Toolと`⚠ 仮置き`表示を再利用する。
確認/却下やProvider事実へ昇格する権限はモデルへ渡さない。
ContextではActivityのID/category/title/schedule/任意placeNameを既存currentTripへ投影し、
候補・realtime情報と分ける。raw Place/候補をContextへ新規追加しない。

previewにはtitle/category/schedule label/任意placeを表示し、質問とも共存する。
既存scheduleラベル関数をpureなApplication応答projectionへ移動し、従来UI入口からre-exportする。
Adapter→UI依存を追加せず、ラベル計算を複製しない。全面UI/採用操作は#390へ残す。

既存`observeViewerTurn`は公開response中のActivity add/replaceをtrip_proposal + itineraryとして扱う。
未公開・失敗で破棄したTool結果、状態のみの変更、単なる本文の完了報告はTTFIにならない。
追加したKは既存Tripへfoodをaddしてrefinement、Lは場所なしwindow自由時間。
A〜Jと従来6指標は維持し、SmokeへK、FullへK/Lを追加した。

## 検証とwriter gate

Domain、原子的Patch、legacy各provider/不正/部分移行、候補ID/証拠/許諾/期限/曖昧性、
Provider raw排除、manual、Context、質問＋previewのDOM、非表示TTFI、同state非固定Toolを検証する。

実行コマンド:

```sh
npm test
npm run build
npm run architecture:check
npm run workspace:check
npm run eval:agent:smoke -- --output-dir /tmp/raiquora-410-smoke
npm run eval:agent:full -- --output-dir /tmp/raiquora-410-full
npm run eval:agent:decision:live -- --suite trip-progress --profile full --output-dir /tmp/raiquora-410-live
```

2026-09-13、設定済みAWSのSTS認証確認が`Your session has expired`で失敗したためLiveは未実施。
認証方式は変えていない。再認証後、上記Liveを実行する。
scriptedのK/Lは各TTFI=1、model call=2 / tool call=1である。常時Reflection等の追加callはない。
実モデルの文章品質・Tool選択・latencyの保証はscripted passと区別する。

検証結果: 全TypeScriptテスト、Frontend/Backend build、architecture/workspace、Bundle budget、
Python 13件、Lambda package checkが成功。Smokeは既存12 + Ask 2 + Trip Progress 4、
Fullは既存42 + Ask 7 + Trip Progress 12が成功した。

PR #427レビュー修正ではPlanAssumption × Activityに限定し、item field適用性の16テストを追加した。
Activity selectionの全status拒否、place有無、schedule全4精度、stay/transport、
不正参照を含むProposalの原本不変を確認した。再実行はTypeScript計1,272件、build、
architecture/workspace、Smoke/Fullすべて成功。Agent Runtimeは変更せず、Liveは再実行していない。
上記AWS認証期限切れによる未実施記録は維持する。

本番LocalStorage writer、server保存、dual-write、Conversation削除は変更していない。
V2の保存/認可/取込は#388、全更新のrevision/CASは#389、UI全面移行は#390。
予約#398、宿snapshot#400、Money#412、一般transport#413、成立性#402、item実績は後続へ残す。

## #410 AC自己レビュー

| AC | 実装 / 試験 |
| --- | --- |
| 観光/食事/体験/イベント | 同じActivity union、全8category試験 |
| 場所なし自由時間 | manual/Application、window、L |
| scheduleの意味維持 | 既存validator/ラベルの再利用、全4精度・不正値 |
| 同じlegacy変換 | 既存converter/test更新、deferred解消/維持・原本不変 |
| 候補と採用の分離 | ID lookupからallowlist snapshot、候補未採用はTrip不変 |
| Provider raw/volatile排除 | 型のexact keysと明示構築、権限/出所/余分fieldの負例 |
| addの明示/原子的意味 | 重複/afterId/順次参照/途中失敗、生成sequence invariant |
| Ask + Progress / TTFI | 本番Runtime、DOM、同質問併記、hidden/内部Toolのみの負例、K/L |
| writer未有効 | Storage/server/会話削除差分なし |
