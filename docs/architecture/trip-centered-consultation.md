# Trip-centered consultation

Related: #751 / #753. This change establishes creation, identity, storage and navigation.
Accepted-condition adoption/display is tracked separately in #761; #753 remains open.

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

## Agent context and remaining adoption work

The server follows the Conversation's Trip reference under the authenticated
owner and rejects mismatched explicit references or missing Trips. An empty
`planningState=inspiration` Trip remains **discovery**; the existence of a Trip
alone does not force detailed planning. Phase derives from stored planning state,
not a keyword/date match on the user's text.

The existing semantic journal still records accepted conversational intent and
pending changes. EffectiveIntent combines the adopted Trip request with that
journal and optional Profile hints. Removing `draftRequest` does not itself mean
all conversational changes have already been adopted into `Trip.request`.
Connecting accepted changes, persistent Trip adoption and the condition display
without competing current-state projections remains #761 within #753.
This PR must not be used to claim that end-to-end adoption is complete or that the
old model repetition problem has been resolved. Explicit Trip mutations already
use the existing revision/receipt contract; they are not inferred from history.

## Validation

- Command-level DynamoDB fake verifies all-or-nothing transaction, durable replay,
  lost acknowledgements, concurrent start, owner isolation and tombstones. It is
  not a live AWS test.
- A signed JWT -> real HTTP handler -> application -> repository test validates
  the public start boundary and rejects injected authority/body fields.
- Browser HTTP clients -> handlers -> applications -> repositories integration
  loses the first successful start response, retries with the same ID, sends a
  turn, reloads persisted history, and applies/reloads an explicit Trip rename.
  The model runner is synthetic; this is not a live Bedrock/provider evaluation.
- Shell/DOM tests cover fresh Hero, no reset on retry, Trip route binding, navigation
  cancellation, and Trip -> consultation -> Trip. Build checks all production
  compositions, including Lambda bundles.

The branch-local verification run `36319787557` passed architecture checks,
production build, `npm test` and `npm run test:agent:v2`, and published source
commit `d77437628fd74f42c2aaae59229ada1b824aaea0`. The exact verified source tree
was `eb1ee3cbc6b17fa5cf425d45bd833fa5ca381261`. Temporary transfer files and its
workflow were removed before that source commit. Normal PR CI is run against the
final PR head separately; this record is not a live provider or deployment claim.

## Branch snapshot (#754)

`branch-consultation` snapshots the owner-scoped Trip and its Conversation header/messages in one DynamoDB transaction. The request identifies the exact source Trip revision, and the transaction also fences the Conversation revision. A concurrent Trip edit or appended message therefore returns a conflict rather than a mixed snapshot. A durable destination receipt makes a retry after a lost response return the same branch.

The destination has a new Trip identity, revision `0`, and `pre_trip` lifecycle. Existing adoption intent is retained only with `needsReconfirmation: true`; copied cost observations are marked stale and rebound to the new Trip identity. Visible user/assistant text and delivery status are copied. Turn execution state, Working State, semantic operation receipts, and actionable proposals are excluded, so a branch cannot replay an old tool call or apply a proposal tied to the source Trip. Source and destination then have independent CAS streams.

The atomic transaction supports at most 94 messages after source fences and destination records. A larger history is rejected as `payload-too-large`, never partially copied.

## Subsequent boundaries

Accepted current-condition adoption/display completion is #761 within #753. Trip
branching/history copy and draft -> confirmed lifecycle are #754; purpose-oriented
Tools/photo answers #755; itinerary insertion/editing #756; weather #757; live
model/provider/browser verification #758.

The local Chromium browser could not open localhost due to environment policy;
no browser screenshot or real-user end-to-end success is claimed for this change.

## #756 first slice: authored day activities (in progress)

The Trip detail's activity form now offers sightseeing, food, experience, event,
and free-time, with an explicit day selection. It resolves the selected day from
the current revision's deterministic daily projection; a logical day is stored
as a relative schedule, while a known calendar day retains its known date and
time zone. It never invents a clock time, venue, provider result or reservation.
An optional focused insertion point must belong to the selected day. The form
previews an `add` proposal and uses the existing authenticated Trip writer's
confirmation, revision CAS and receipt path; simply entering a title does not
persist a Trip change. A stale day is rejected before preview.

## #756 second slice: individual item decisions (in progress)

An item may carry a separate user decision timestamp. A typed, authenticated
preview/confirm operation identifies the exact Trip, item, revision and mutation;
the server binds the confirmation key to that operation, then uses the existing
Trip CAS/receipt writer. Generic `add`/`replace` payloads cannot grant a confirmed
decision. Editing or moving a confirmed item marks only that item for review;
unrelated items retain their status. A branch marks all copied item decisions for
review, without copying bookings or replaying operations. Unselected stays,
unresolved transport and meals with no identified place cannot be confirmed.
The UI exposes a separate item action only to an owner, and explicitly states
that confirmation is not booking, payment or verification.

These are partial slices of #756. Provider-backed search, selection and comparison
for each gap, transport/accommodation selection, and chat-side adoption/editing
are still missing. Neither #756 nor #751 is complete on this basis.

## #756 third slice: contextual search hints (in progress)

When an authenticated Trip is loaded for a conversation turn, the read-only
`get_trip_search_context` Tool accepts an item ID from that Trip and returns the
anchor and the next item in authored item order, their retained schedules, and
only retained place names/areas/coordinates where present. An unknown ID, extra
Trip reference or stale revision cannot retrieve another Trip's data. These are
search hints for existing read Tools, not proof of physical proximity, free time,
travel feasibility or current opening hours. Manual place facts are explicitly
marked unverified. The Tool neither performs provider search nor adopts a result;
provider-backed contextual ranking and a selection flow remain open.

## #756 fourth slice: Trip-bound restaurant search (in progress)

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

## #756 fifth slice: Trip-bound place discovery (in progress)

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

## #756 sixth slice: user-authored named stop (in progress)

The day activity form can also preview a user-entered place name, for example a
specific restaurant for lunch. The existing `proposeManualActivity` boundary
creates an unverified manual PlaceSnapshot containing only the name and no
provider identity, coordinates, source or booking claim. Day and item ordering
remain explicit, and the server Trip changes only after the normal proposal
confirmation. A name copied from a search result is still manual user input;
this form does not convert provider candidate Evidence into a retained selection.
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

## #756 seventh slice: shared item-change preview

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

## #756 eighth slice: bounded OTP ground route search

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
