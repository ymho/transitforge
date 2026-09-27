# Trip-centered consultation

## Authority

A travel consultation has exactly one Trip from the first submitted user message.
Opening the Hero creates nothing. On first submit the client creates an empty `planningState=inspiration` Trip, then creates a Conversation whose immutable travel reference is that Trip, activates/read-backs both, and only then starts the Agent turn.

Trip owns current travel intent, itinerary items, planning/lifecycle state and later adoption. Conversation owns ordered user/assistant history only. It is not a draft Trip and has no `draftRequest`.

Persisted Conversation metadata is `scope=trip` with a required `tripId`. General/place/route standalone Conversations are not part of the new product model. The unsent Hero may use an in-memory placeholder without a Trip; it is never persisted.

## Failure and navigation

Trip creation failure creates no Conversation and sends no model request.
Conversation creation failure best-effort archives the newly created Trip. If cleanup is unavailable, the valid Trip remains recoverable from the Trip list; it is never silently used as another Conversation.
Account or navigation generation changes are checked after asynchronous boundaries. A stale completion never sends a prompt to another Trip.

## Agent context

The server loads the Conversation, follows its Trip reference under the authenticated owner, and builds EffectiveIntent from the Trip request plus current semantic overlay and Profile soft hints.
There is no Conversation-draft fallback. Missing referenced Trip is an error rather than an empty consultation.
Verified intent changes produce Trip request proposals from the first turn.

## Navigation

Top-level Consultation always starts a new unsent Hero. Existing consultation is resumed from Trip list -> Trip -> consultation.
Trip navigation may create a missing history stream for an existing Trip, but never creates a second Trip.
No chat-list product surface or legacy history migration is provided.

## Next boundaries

Trip branching/history copy and draft->confirmed lifecycle are #754.
Purpose-oriented discovery/drafting Tools are #755. Itinerary insertion/editing is #756.
