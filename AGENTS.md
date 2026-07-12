# AGENTS.md

## Working mode

This repository is a greenfield project.

Use only the requirements, decisions, and source code currently stored in this
repository or explicitly provided in the active task. Do not assume an earlier
implementation, hidden convention, existing data format, or preferred
technology stack.

## Before changing code

1. Read `README.md`.
2. Read `docs/product-brief.md`.
3. Read applicable records in `docs/decisions/`.
4. Inspect existing tests and development commands.
5. State assumptions when the repository does not yet define an answer.

## Change principles

- Keep each change focused.
- Do not introduce a framework or service without recording why it is needed.
- Separate domain concepts from UI, storage, networking, and vendor-specific
  implementations.
- Do not commit credentials, personal data, copyrighted datasets, or large
  generated files.
- Prefer generated outputs that can be reproduced from versioned inputs.
- Avoid unrelated formatting or refactoring.
- Preserve backward compatibility only when the repository explicitly requires
  it.
- Update documentation when behavior, commands, interfaces, or architecture
  changes.

## Validation

Before declaring a task complete:

1. Run the repository's documented formatting, lint, test, and build commands.
2. Report commands that were not run and why.
3. Review the final diff for accidental or unrelated changes.
4. Confirm that no secrets or generated bulk data were added.

## Git

- Do not commit, push, merge, rewrite history, or create releases unless
  explicitly requested.
- Use small, descriptive commits when commit creation is requested.
- Do not work directly on a protected default branch.
