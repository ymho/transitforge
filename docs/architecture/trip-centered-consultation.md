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
