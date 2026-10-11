# 相談と旅程の開始・継続

## Creation and authority

Opening the Hero creates nothing. The first submitted user message calls
`POST /api/trips/v1` with `operation=start-consultation`, a document-local stable
`tripId`, and a display title. A title is never parsed into destination/date facts.

The authenticated Trip application atomically writes an empty inspiration Trip,
its Trip-owned Conversation header, a durable start receipt, and the standard
Trip-created outbox event. The existing Trip writer's IAM covers both DynamoDB
tables. The history ID is the Trip ID in a separate owner-scoped namespace;
it is not a second copy of the Trip.

Trip owns adopted request/itinerary/planning/lifecycle data. Conversation metadata
contains no `draftRequest`: it contains only the immutable Trip reference and
history/summary metadata. Persisted metadata requires `scope=trip` and `tripId`.
An unsent Hero may use an in-memory UI placeholder without a Trip; that placeholder
is never sent to the server as a persisted Conversation.

## Failure, replay and navigation

The start receipt binds owner, Trip ID and normalized title. A retry with the same
identity returns the current linked Trip; a different payload is rejected. Receipt
retention is not limited to the SDK's short-lived transaction token. Concurrent
starts cannot create duplicate Trips/history streams. An existing unrelated Trip,
archived Trip or deleted history is not overwritten or resurrected.

A lost HTTP/DynamoDB acknowledgement does **not** cause compensating archive or
delete. The transaction may already have committed. Failure before commit leaves
all four records absent; retry after commit resolves from the receipt. The browser
retains the same start identity for the same failed submission until the user
selects a new consultation or changes account/prompt.

Before sending the first model request, the browser independently reads and
activates the linked history and actual Trip source. It checks navigation/account
validity after asynchronous boundaries and verifies both active IDs. Metadata
alone is not successful Trip read-back. A failed list refresh cannot suppress an
otherwise valid first submission.

Top-level Consultation is always a fresh Hero. Existing consultation is resumed
through Trip list -> Trip -> consultation. Opening an existing Trip can create its
missing history under the same deterministic ID, only after owner authorization.
Updating metadata cannot move a history stream to another Trip. Streaming cannot
implicitly create an unknown/general Conversation.

## Storage cutover

New state records use `TRIP_CONVERSATION#`, `TRIP_MESSAGE#`, `TRIP_TURN#`, and
`TRIP_WORKING#`. Old standalone Conversation rows are not listed, decoded, migrated,
or used as fallback, and are not deleted by this change. Trip body storage remains
with the existing Trip repository. No new chat-list product surface is provided.

## Agent context and condition authority

The server follows the Conversation's Trip reference under the authenticated
owner and rejects mismatched explicit references or missing Trips. An empty
`planningState=inspiration` Trip remains **discovery**; the existence of a Trip
alone does not force detailed planning. Phase derives from stored planning state,
not a keyword/date match on the user's text.

The semantic journal records accepted conversational intent and pending changes.
EffectiveIntent combines the adopted Trip request, this journal and optional Profile hints.
Accepted condition changes use the authenticated Application's atomic adoption path;
explicit Trip mutations use the revision/receipt contract rather than inferred history.
The current condition authority and display are specified in [Trip conditions](trip-conditions.md).

## Branch snapshot

`branch-consultation` snapshots the owner-scoped Trip and its Conversation header/messages in one DynamoDB transaction. The request identifies the exact source Trip revision, and the transaction also fences the Conversation revision. A concurrent Trip edit or appended message therefore returns a conflict rather than a mixed snapshot. A durable destination receipt makes a retry after a lost response return the same branch.

The destination has a new Trip identity, revision `0`, and `pre_trip` lifecycle. Existing adoption intent is retained only with `needsReconfirmation: true`; copied cost observations are marked stale and rebound to the new Trip identity. Visible user/assistant text and delivery status are copied. Turn execution state, Working State, semantic operation receipts, and actionable proposals are excluded, so a branch cannot replay an old tool call or apply a proposal tied to the source Trip. Source and destination then have independent CAS streams.

The atomic transaction supports at most 94 messages after source fences and destination records. A larger history is rejected as `payload-too-large`, never partially copied.

## User-authored activities

An authored activity belongs to a day in the current revision's deterministic daily
projection. A logical day retains a relative schedule; a calendar day retains its
known date and time zone. An optional insertion anchor must belong to that day.
A stale day is rejected before preview. The Application never invents a clock time,
venue, provider result or reservation. The current editing UI is defined in
[Trip workspace](trip-workspace.md).

## Individual item decisions

An item may carry a separate user decision timestamp. A typed, authenticated
preview/confirm operation identifies the exact Trip, item, revision and mutation;
the server binds the confirmation key to that operation, then uses the existing
Trip CAS/receipt writer. Generic `add`/`replace` payloads cannot grant a confirmed
decision. Editing or moving a confirmed item marks only that item for review;
unrelated items retain their status. A branch marks all copied item decisions for
review, without copying bookings or replaying operations. Unselected stays,
unresolved transport and meals with no identified place cannot be confirmed.
Decision confirmation is separate from booking, payment and verification.
The public workspace exposes the controls described in [Trip workspace](trip-workspace.md);
the presence of an internal operation does not itself provide a public action.

## Contextual search hints

When an authenticated Trip is loaded for a conversation turn, the read-only
`get_trip_search_context` Tool accepts an item ID from that Trip and returns the
anchor and the next item in authored item order, their retained schedules, and
only retained place names/areas/coordinates where present. An unknown ID, extra
Trip reference or stale revision cannot retrieve another Trip's data. These are
search hints for existing read Tools, not proof of physical proximity, free time,
travel feasibility or current opening hours. Manual place facts are explicitly
marked unverified. The Tool neither performs provider search nor adopts a result;
provider-backed contextual ranking and a selection flow remain open.

## Trip-bound restaurant search

The owner-scoped conversation turn also exposes `search_trip_gap_restaurants`.
The model supplies an anchor item ID and optional cuisine/restaurant filters;
the authenticated Trip, not the model, supplies the area and any retained search
coordinate. Hot Pepper's existing provider boundary searches only around that
anchor, with the next authored item and its schedule returned as context. Missing
location, foreign item IDs and stale revisions do not call the provider. The
response retains provider status/evidence (including an unavailable result) and
never writes to the Trip. A result near the anchor is not necessarily near the
next item or feasible in the available time. Geographic and schedule validation,
candidate selection and adoption remain open.

The restaurant gap Tool distinguishes zero returned records from an unavailable
provider. A successful zero-record response supports a purchase/carry option
for that limited query; it does not prove no restaurant exists in the area.

## Trip-bound place discovery

`search_trip_gap_places` uses the same owner-scoped Trip boundary to discover
places by a user-selected topic. With a retained coordinate, Mapbox's proximity
is only a ranking hint, so the Tool explicitly drops returned places outside a
bounded straight-line radius; candidates without coordinates remain marked as
distance-unknown. With only a saved area it sends an area-qualified query, but
does not claim geographic verification. A limited provider response cannot prove
that no other places exist. Results retain their provider evidence, are not
adopted, and do not establish current opening hours, travel feasibility or
whether an event occurs on the Trip day. Event-specific research and an explicit
candidate adoption workflow are still required.

## Named stops and cited place adoption

The manual activity Application can preview a user-entered place name, for example a
specific restaurant for lunch. The existing `proposeManualActivity` boundary
creates an unverified manual PlaceSnapshot containing only the name and no
provider identity, coordinates, source or booking claim. Day and item ordering
remain explicit, and the server Trip changes only after the normal proposal
confirmation. A name copied from a search result is still manual user input;
this operation does not convert provider candidate Evidence into a retained selection.
Provider-backed selection continues to require a trusted candidate resolver,
source-bound identity and field-specific retention permission.

The owner can also select a cited place card in the Trip conversation and
choose a Trip day and activity kind. This creates a revision-bound preview,
which becomes a Trip item only after explicit confirmation. The retained memo
contains the chosen name, citation URL and the material's retrieval timestamp;
it does not store a provider place ID, coordinates, raw search results or a
claim about present opening, availability or booking. The Trip view and its
Agent context preserve the reference date. Candidate cards and saved items
show an as-of reminder, and a request for current conditions calls for a fresh
lookup against the source or an available provider.

## Shared item-change preview

The Trip workspace and the owner-scoped conversation now produce the same
revision-bound `TripUpdateProposal` through `proposeTripItemChange`. Explicit
add, rename, remove, reorder or move to an existing Trip day, manual activity place replacement, manual non-rail transport selection and manual stay
place selection remain previews until the user confirms them in the Trip screen.
The Agent tool derives the Trip ID and revision from the authenticated snapshot;
the model can reference only its current day and item IDs. Stored conversation
history and stream responses carry a bounded item proposal so the user can
resume its confirmation from either surface. Manual entries retain no provider
identity, coordinates, timetable, hotel selection or booking state. An
unresolved transport/stay item may be added before any selection. Candidate
adoption from live search remains subject to verified source identity and
field-specific retention, and is not inferred from these manual changes.

## Bounded OTP ground route search

The owner-scoped `search_trip_gap_ground_routes` read Tool binds its origin to a
saved Trip item's coordinate. Its destination is either the next saved item's
coordinate or an explicitly supplied candidate coordinate, which is labeled
unverified and never saved. An optional Trip revision prevents a stale search.
The request includes a concrete departure instant; bus queries require Japan's
`+09:00` offset so GTFS's service date is not confused with UTC. The provider
searches OTP GraphQL `planConnection` with `directOnly: WALK` for walking, or
`transitOnly: BUS` plus OTP walking access/egress/transfer for bus journeys. It
rejects a bus response without a bus leg, malformed timings and geometries.
The encoded route geometry is decoded to GeoJSON order `[longitude, latitude]`.

`OTP_GRAPHQL_ENDPOINT` and `OTP_COVERAGE_JSON` must be configured together.
The latter records bounded WGS84 coordinates, GTFS serviceStart/serviceEnd,
feedUrl/feedRetrievedAt, graphBuiltAt and attribution. Missing configuration
keeps the Tool disabled. An outside graph location or bus date returns
`outside_coverage`; a valid zero-itinerary response is `no_route`; a graph,
HTTP or response failure is `unavailable`. Walking uses OSM outside GTFS service
dates within the graph's geographic bounds. The Tool returns scheduled leg
times and geometry, with source and freshness; it only compares fixed Trip
anchor end and next-item start (or latest window end) when both exist. Candidate
detours and opening hours remain unverified. Neither a route search nor the
schedule comparison changes the Trip or represents a booking.

When a candidate stop lies between the anchor and the next saved item, the
caller can request `checkNext` with a specific provisional `candidateStayMinutes`
and optional `nextMode`. The Tool searches anchor→candidate, then (for at most
two first-leg options) candidate→next with the actual first arrival plus that
stay. It compares each second arrival with the next saved item's known deadline.
Without an explicit stay assumption or a next-item coordinate it returns a
missing-precondition result; it never fills an unknown stay or opening time.
The cited public preview may draw both OTP segments with the assumed dwell
shown as a separate stop. A failed second search remains partial and does not
turn the first leg into a feasible full journey.

When the Agent actually cites a route observation, Application projects one
bounded route into a validated public presentation. Conversation history and
the SSE final event carry the same projection. The conversation renders
scheduled legs with GTFS source and as-of timestamps, and an explicit map
button draws OTP's bounded leg geometries on a separate Mapbox overlay, with
distinct bus/walk colors. It does not add a Trip item. Other queried routes
remain in the Tool output and evidence summaries rather than an implicitly
chosen persisted route.

The deployment is feature-gated until a real graph version exists. Data Builder
owns HTTPS acquisition, GTFS validation, digest-pinned OTP graph construction,
content-addressed input archives, and versioned graph+manifest publication. Transitforge owns a private Fargate
OTP service and an IAM-only VPC Bridge Lambda; the non-VPC Agent invokes the
bridge and independently validates the same pinned S3 manifest. There is no
public OTP ingress and `current.json` cannot switch production implicitly.
Audited real-data graph construction, route integration tests and activation
remain outstanding. The existing
Mapbox walking Tool remains available for legacy ground access; it is not
merged with an OTP bus itinerary.
`tools/otp/README.md` remains a local smoke workflow. The production builder is
owned by `transitforge-data-builder`; input archives and resulting graphs are
never committed.

`search_rail_bus_connections` also uses the existing first-party rail Journey
operation. It loads the same generated station catalog as the Viewer from the
website object; the IAM grant permits only that object. From the candidate
destination it considers up to three physical stations within 30 km (official
access-page station names may rank them, never certify a route), excludes
ambiguous station coordinates, and searches up to two rail journeys per station.
For each rail arrival it queries OTP BUS+WALK after a minimum five-minute
transfer. It returns at most five candidates, ranked by actual destination
arrival. A missing/failed feed is distinguished from a searched zero result.
Rail segment geometry is not manufactured for the Mapbox overlay; the separate
ground preview shows only OTP-supplied street and bus geometry. The composed
Tool still requires a deployed graph and its manifest to become available.

## 画面契約

主要メニューは「相談・旅程・運行・設定」の4項目。探すを独立した画面・routeにしない。
`#chat`が共通の相談画面で、新規時だけ従来の写真Heroとcomposerを表示する。
利用者が送信するとTripとそのServer Conversationを原子的に作成して通常の相談へ移る。未送信の文字入力やIME変換だけでは画面を切り替えない。
未ログイン送信は入力を保持して認証へ進む。未認証で会話・旅程・運行APIを利用しない。

起動・再読み込み・メニューの相談・新規相談ボタンでは、過去の一般チャットを自動選択しない。
初期画面表示だけで空のServer Conversationを作らない。既存履歴の移行・互換routeは用意しない。
過去のサーバデータを自動削除・移行する操作はない。

## 旅程の相談

旅程一覧から旅程を開き、各予定の「相談」で対象を指定して同じ相談画面へ移る。Heroは出さない。
相談の「旅程に戻る」で同じTripの画面へ戻す。会話は既存の認証済みTrip参照から取得し、別のTripや直近チャットへfallbackしない。
履歴へ戻る操作でTripの相談を復元する場合も、明示されたTrip参照を再認可・取得する。
URLにTrip本文・owner・認証情報を含めず、現在の画面参照だけをhistory stateに置く。

## 実装境界

Shellはroute/landing/開始中/会話/取得失敗を管理する。Trip workspaceの表示切替はShellへ通知するだけで再取得や新規会話作成を再帰実行しない。
新規相談の作成完了はawaitし、二重送信・別画面へ移動後の遅延完了・認証変更を隔離する。
Trip相談の非同期復元も、ポートを呼ぶ直前と完了後の両方で最新の画面遷移を確認する。古い復元処理が新規相談を開き直すことはない。
開始失敗時はHeroの入力を保持する。Trip取得失敗時はHeroへ戻さず対象の再試行を示す。

プロフィール、Trip作成・分岐、目的別Toolは各Applicationの契約に従う。
Agentモデル・prompt・実行上限・保存済みTripへの操作契約・IAMは変更しない。

ブラウザ確認の手順は[検証運用](../operations/testing.md)を参照する。

## 新規相談の対象判定

新規相談はTrip APIで最初の入力全文を対象判定してから、TripとConversationを原子的に作成する。タイトル用に省略した文字列だけで判断しない。判定は読み取り専用のBedrock呼び出し1回で、旅行・お出かけ・観光・移動・宿泊の相談と対象外を構造化Tool出力へ分類する。判定結果で旅行条件を受理したり検索・保存したりしない。

「積分の公式を教えて」など対象外の相談には対象範囲の案内を返し、Trip・Conversation・開始receiptは作成しない。入口に案内と元の入力を残し、既存の会話を開かない。判定がタイムアウト・形式不正・Provider失敗の場合も書き込まず、入口から再試行する。旅行として受理された場合だけ従来の開始・read-back・初回送信を続ける。既存旅程の継続相談・分岐にはこの初回判定を追加しない。

Trip APIの実行権限に既存の設定済みBedrockモデル群へのInvokeModelを追加する。判定モデルは軽量モデル設定を優先し、空なら通常モデルを使う。呼び出しは9秒で中止し、Trip APIの15秒のタイムアウト内に保存する余裕を残す。追加の対象判定には初回のみモデル呼び出しの時間・費用が発生する。
