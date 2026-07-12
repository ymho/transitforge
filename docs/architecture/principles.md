# Architecture principles

These are starting constraints, not a final architecture.

## 1. Domain before infrastructure

Model the concepts and behavior required by the first use case before selecting
cloud services, databases, message brokers, or UI frameworks.

## 2. Small vertical slices

Prefer a complete thin path from input to visible result over a large partial
platform.

## 3. Explicit boundaries

Keep these concerns separable:

- domain model;
- data acquisition and import;
- simulation or state calculation;
- query and API interfaces;
- visualisation;
- infrastructure and deployment.

Separation does not require separate services. Start with modules unless an
operational reason justifies distribution.

## 4. Reproducibility

Derived data should be reproducible from versioned source inputs and code.
Manual corrections must be captured as explicit, reviewable rules or data.

## 5. Observability from the start

Important pipelines and runtime paths should expose errors, durations, input
versions, and output counts.

## 6. Measured performance

Do not optimise from intuition alone. Define representative workloads and
record measurements before and after meaningful performance changes.

## 7. Replaceable external dependencies

Wrap vendor-specific APIs and data formats behind narrow interfaces where the
cost is reasonable.

## 8. Secure defaults

Keep secrets outside the repository, minimise collected data, and grant only
the permissions required for the current use case.
