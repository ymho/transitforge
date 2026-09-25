# ADR 0092: Resolve conversation scope selectors in Application

Status: accepted

## Context

The semantic interpreter previously emitted every ordinary condition with conversation scope. A statement such as `2日目だけ活発` could therefore shadow a whole-trip pace even though the cited user fragment limited the condition to one day. Allowing the model to emit `logicalDayId` or `segmentId` directly would instead let it manufacture Application references.

## Decision

The interpreter contract may emit only bounded selectors: a logical-day ordinal or an outbound/return direction. The operation must still cite an exact substring of the trusted current user turn. Application validates a day ordinal against that cited substring and creates the stable scope reference (`day-N` or the directional segment namespace). Candidate selection continues to resolve only through an Application-owned presentation receipt.

The selector is optional; omission means conversation scope. The accepted delta, reducer receipt, Effective Intent, proposal semantic provenance, persistence and public receipt continue to carry the resolved scope rather than the model selector.

## Consequences

- A day-specific preference no longer replaces or suppresses whole-trip or other-day conditions.
- The model cannot self-issue scope IDs, owner references, revisions or authority.
- A selector unsupported by its cited user fragment is rejected before intent acceptance.
- Participant-specific references still require an Application-owned party reference and remain unresolved until that reference path is available; a free-form participant label is not promoted to an ID.
