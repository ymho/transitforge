# ADR 0093: Trace semantic phases from observed boundaries

- ステータス: Accepted
- 日付: 2026-09-25
- 関連: Epic #631、#647、#650、#652、ADR 0083

## Context

The existing Agent diagnostics separated context, Tool, response policy and save failures, but semantic acceptance appeared only as a generic decision event. A support report could not distinguish an interpretation failure from a scope-resolution failure, a persisted acceptance, or an SSE publication failure.

## Decision

Extend the existing allowlisted diagnostic event rather than create another event store. The conversation Application emits phase events for `interpret`, `resolve`, `accept`, `respond`, `publish` and `save` at the boundary it actually observed. Events carry only stable reason codes, counts, operation references and version/revision correlation. They never contain the utterance, interpreted values, Profile fields, reservation data, prompts, model reasoning or raw Tool output.

The broader phase vocabulary also reserves `authorize`, `reduce`, `compile-context` and `select-action` for the respective owners to emit when those boundaries expose an observed result. Existing `context`, `decision`, `runtime` and other phase names remain readable for compatibility.

## Consequences

- A persisted acceptance and a failed answer/publication can be diagnosed independently.
- Accepted-intent retry publishes the same bounded receipt and records publication without reinterpreting the user turn.
- Diagnostics remain best effort and cannot fail a conversation turn.
- These events are operational proxies, not a claim that production semantic correctness is known without a gold label.
