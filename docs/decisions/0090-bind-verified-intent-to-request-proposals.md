# ADR 0090: Bind verified conversation intent to request proposals

- ステータス: Accepted
- 日付: 2026-09-25
- 関連: Epic #631、#634、#640、#641、#642、#643、ADR 0088

## Decision

Application, not the model, deterministically projects the current accepted semantic receipt and `EffectiveIntent` into a reviewable request-only proposal. The projection keeps `source=user` only for facts whose provenance was validated against the current user turn or trusted UI action.

`TripUpdateProposal` and `ConsultationRequestProposal` may carry `intentBinding v1`: conversation ID, exact intent revision, EffectiveIntent fingerprint, and the accepted change/group references represented by the proposal. This binding contains no values or quotes. Model-authored assumption/change Tools cannot supply it.

Persisted constraints may carry versioned semantic provenance (fact reference, source operation, target, scope, modality and precision). This prevents a verified explicit condition from being converted into a model/unconfirmed assumption and keeps source and strength separate. Unsupported meanings remain in the conversation overlay and are not falsely reported as proposed.

The projection is attribute- and scope-aware. It removes only base references suppressed by the verified operation, preserves unrelated interests, and emits explicit unknown/retraction as removal rather than reviving a Profile default. Hypothetical facts never enter a saved-Trip proposal.

Public proposal validation now uses the authenticated Trip API's 100-condition aggregate limit instead of the older 40-condition cap. Byte, schema, owner, review, reservation, confirmation and Trip CAS protections remain.

## Consequences

- Conversation acceptance remains low-risk and automatic; Trip/draft persistence still requires the existing explicit review path.
- The same deterministic proposal is persisted in history and delivered over SSE/UI boundaries.
- Proposal adoption validates this binding against Working State and records exactly which change/group references were consumed through ADR 0091のdurable reservation。Proposal生成だけでは引き続き消費・保存完了を意味しない。
