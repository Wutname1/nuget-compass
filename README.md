# nuget-compass

A VS Code extension for managing NuGet packages in .NET Core / .NET 5+ projects, with first-class **target framework (TFM) compatibility filtering**.

## Why this exists

Visual Studio's NuGet Package Manager UI shows the "latest" version of every package regardless of whether it actually targets your project's framework. On a `net8.0` project, you'll see `net10.0`-only packages offered as updates, and "Update All" happily tries to install them — usually resulting in `NU1202: Package X is not compatible with net8.0`.

This bug has been open against Visual Studio since 2022 and is unfixed as of mid-2026. C# Dev Kit is closed-source and Microsoft-account-gated. The leading OSS extension (`aliasadidev.nugetpackagemanagergui`) is TFM-blind by design — its csproj parser never reads `<TargetFramework>` and its NuGet API client returns all versions sorted lexically.

`nuget-compass` is built around the assumption that **every version offered to you should be one you can actually install**.

## Status

Early development. See [`docs/spec.md`](docs/spec.md) for what v0.1 will and will not do.

## Repo layout

```
nuget-compass/
├── docs/             # Spec, research, design (read these first)
├── fixtures/         # Test .NET projects used during development
└── packages/         # Source code (pnpm workspace; populated as build-out begins)
```

## Documentation

- [`docs/spec.md`](docs/spec.md) — Specification and architecture
- [`docs/research.md`](docs/research.md) — Empirical research backing the design (.NET SDK capabilities, NuGet API, fork analysis)
- [`docs/features.md`](docs/features.md) — feature set, milestone breakdown, current status
- [`docs/ui-design.md`](docs/ui-design.md) — UI layout, controls, interaction model

## License

MIT — see [LICENSE](LICENSE).
