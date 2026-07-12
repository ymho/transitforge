# TransitForge

TransitForge is a greenfield personal project for visualising planned train
movements from prepared full-network route and timetable data.

## Status

Product brief and initial viewer input contract defined.

No application architecture, programming language, framework, rendering library,
cloud platform, or deployment model has been selected yet.

## Goals

- Define the problem before selecting technology.
- Build the smallest useful end-to-end slice first.
- Keep domain logic independent from presentation and infrastructure.
- Make important decisions explicit and reviewable.
- Add automated checks alongside implementation.
- Prefer reproducible data processing over manual correction.

## Repository structure

```text
.
├── .github/
│   └── pull_request_template.md
├── docs/
│   ├── architecture/
│   │   └── principles.md
│   ├── decisions/
│   │   ├── 0000-template.md
│   │   └── README.md
│   └── product-brief.md
├── .editorconfig
├── .gitattributes
├── .gitignore
├── AGENTS.md
├── CHANGELOG.md
├── CONTRIBUTING.md
└── README.md
```

## First steps

1. Measure the actual full-size input files.
2. Define the minimum complete viewer and performance targets.
3. Compare and select the technical stack.
4. Record the initial technology decisions under `docs/decisions/`.
5. Create the development environment.
6. Add build, test, lint, and CI commands to this README.

## Development commands

Not defined yet. Add commands here after the development environment is selected.

## License

No license has been selected. Do not assume permission for external reuse or
distribution until a license is added.
