# Contributing

## Workflow

1. Create a branch from the current default branch.
2. Make one focused change.
3. Add or update tests where behavior changes.
4. Update documentation where interfaces, commands, or decisions change.
5. Run all documented checks.
6. Open a pull request using the repository template.

## Branch names

Use short names that describe the intent.

```text
feature/first-map-view
fix/timetable-parser
docs/product-scope
chore/development-environment
```

## Commit messages

Use an imperative summary.

```text
Add initial product brief
Define station domain model
Configure local development environment
```

## Architecture decisions

Create an Architecture Decision Record when a change selects or rejects a
meaningful technical direction, including:

- primary language or framework;
- mapping or visualisation engine;
- data acquisition strategy;
- storage technology;
- public API shape;
- deployment platform;
- authentication model;
- major performance trade-off.

Copy `docs/decisions/0000-template.md` and assign the next number.

## Pull requests

A pull request should explain:

- the problem;
- the chosen approach;
- important alternatives;
- validation performed;
- remaining risks or follow-up work.
