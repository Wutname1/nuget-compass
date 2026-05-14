# Test Fixtures

Real .NET projects used during development to validate the extension against the SDK and NuGet API.

## `net8-mixed-versions/`

A `net8.0` console project with 13 packages deliberately pinned to outdated versions spanning multiple categories:

| Category           | Package                                    | Pinned | Latest seen                       |
| ------------------ | ------------------------------------------ | ------ | --------------------------------- |
| Microsoft platform | `Microsoft.EntityFrameworkCore`            | 8.0.0  | 10.0.7 (net10-only — TFM trap)    |
| Microsoft platform | `Microsoft.Extensions.Logging`             | 8.0.0  | 10.0.7 (multi-target — TFM ok)    |
| Microsoft platform | `Microsoft.Extensions.Configuration`       | 8.0.0  | 10.0.7 (multi-target — TFM ok)    |
| Microsoft platform | `Microsoft.Extensions.DependencyInjection` | 8.0.0  | 10.0.7 (multi-target — TFM ok)    |
| Microsoft platform | `System.Text.Json`                         | 8.0.0  | 10.0.7 (vulnerable; multi-target) |
| Serialization      | `Newtonsoft.Json`                          | 13.0.1 | 13.0.4                            |
| Logging            | `Serilog`                                  | 3.1.1  | 4.3.1 (major bump)                |
| Resilience         | `Polly`                                    | 8.2.0  | 8.6.6                             |
| Mapping            | `AutoMapper`                               | 12.0.1 | 16.1.1 (vulnerable; major bump)   |
| Validation         | `FluentValidation`                         | 11.8.0 | 12.1.1 (major bump)               |
| Data               | `Dapper`                                   | 2.1.21 | 2.1.72                            |
| Mediator           | `MediatR`                                  | 12.2.0 | 14.1.0 (major bump)               |
| Testing            | `xunit`                                    | 2.6.0  | 2.9.3                             |

### Why these were chosen

This mix exercises every interesting case the extension must handle:

1. **Single-targeted Microsoft package crossing the .NET boundary** (`Microsoft.EntityFrameworkCore` 10.0.7 → `net10.0` only) — the canonical TFM trap. Default `--outdated` will offer it; install fails with NU1202.
2. **Multi-targeted Microsoft package** (`Microsoft.Extensions.Configuration` 10.0.7 → also targets `net8.0`) — looks identical in SDK output but should actually be offered. Without per-version catalog data, can't be distinguished from case 1.
3. **Major-version bump in third-party** (`Serilog` 3 → 4, `AutoMapper` 12 → 16) — `--highest-minor` would silently hide these; user wants to see them with major-allowed mode.
4. **Vulnerability hits** (`AutoMapper` 12.0.1, `System.Text.Json` 8.0.0) — High-severity from `dotnet package list --vulnerable`.
5. **Patch-only available** (`Newtonsoft.Json` 13.0.1 → 13.0.4) — exercises the patch-only filter.
6. **Plain minor bump** (`Polly` 8.2.0 → 8.6.6, `Dapper` 2.1.21 → 2.1.72) — default minor filter should surface.

### Manual reproduction

```bash
cd fixtures/net8-mixed-versions

# The exact bug we're fixing — VS-style "latest" suggestion that breaks
dotnet add package Microsoft.EntityFrameworkCore --version 10.0.7
# → error: NU1202: ... not compatible with net8.0 ...

# Default outdated (TFM-blind, the bug)
dotnet package list --outdated --format json

# Highest-minor (heuristic, hides safe major upgrades)
dotnet package list --outdated --highest-minor --format json

# Vulnerability scan (free signal we want to surface)
dotnet package list --vulnerable --format json
```

### Maintenance

- Do **not** run `dotnet outdated` and accept fixes here. The point of this fixture is that packages are _out of date._
- If new .NET versions release and these packages no longer demonstrate the TFM trap, update the matrix above and re-pin to whatever versions reproduce the same scenarios.
- The `bin/` and `obj/` directories are in `.gitignore`; restore is on-demand.

### Captured SDK output

`packages/extension/src/dotnet/__fixtures__/` contains JSON snapshots of `dotnet package list` output against this project. Used by unit tests so the parser doesn't need a working .NET install at test time.

To regenerate after pinning new package versions:

```bash
cd fixtures/net8-mixed-versions
dotnet restore
dotnet package list --format json > ../../packages/extension/src/dotnet/__fixtures__/net8-installed.json
dotnet package list --include-transitive --format json > ../../packages/extension/src/dotnet/__fixtures__/net8-installed-with-transitive.json
```
