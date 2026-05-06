# Specification

## Identity

- **Name (working):** nuget-compass
- **Marketplace ID (proposed):** `<publisher>.nuget-compass`
- **Tagline:** "NuGet for VS Code, with target framework filtering that actually works."
- **License:** MIT
- **Audience:** .NET Core / .NET 5+ developers using VS Code without C# Dev Kit. Cross-platform: Windows, macOS, Linux.

## Problem

See [`research.md`](research.md) §1. Default NuGet UIs offer "latest" versions that are incompatible with the project's target framework. Resulting `NU1202` failures hit every .NET developer for ~12 months of every LTS-to-LTS cycle.

## Engine architecture

Hybrid — `.NET SDK` for project state and mutations, NuGet v3 catalog API for per-version TFM data. See [`research.md`](research.md) §7 for the rationale.

```
┌───────────────────────┐     ┌──────────────────────────┐
│  .NET SDK subprocess  │     │  NuGet v3 catalog HTTP   │
│                       │     │                          │
│ - dotnet package list │     │ - registration5-semver1  │
│   --format json       │     │ - catalogEntry pointer   │
│ - --outdated          │     │ - dependencyGroups[]     │
│ - --vulnerable        │     │   .targetFramework       │
│ - --deprecated        │     │                          │
│ - dotnet package      │     │ Cached per {id}@{ver}    │
│   search --exact      │     │ (immutable URLs)         │
│ - dotnet add/remove   │     │                          │
│   package             │     │                          │
└───────────┬───────────┘     └────────────┬─────────────┘
            │                              │
            └──────────────┬───────────────┘
                           │
                ┌──────────▼───────────┐
                │  TFM compat resolver │
                │  (static table)      │
                └──────────┬───────────┘
                           │
                ┌──────────▼───────────┐
                │  Update-level filter │
                │  (patch/minor/major) │
                └──────────┬───────────┘
                           │
                ┌──────────▼───────────┐
                │      Webview UI      │
                └──────────────────────┘
```

## v0.1.0 — MVP scope

### In scope

1. **Project discovery.** Enumerate `*.csproj`, `*.fsproj`, `*.vbproj` in workspace via VS Code workspace API. Group results per project. Read TFM via `dotnet package list --format json`.
2. **Installed package listing.** Show every `<PackageReference>` with current version, resolved version, and the project's TFM. Differentiate top-level vs. transitive (transitive hidden by default).
3. **Available versions per package.** Backed by `dotnet package search --exact-match` for enumeration + NuGet catalog API for per-version TFM.
4. **TFM compatibility filter (binary).** Default: hide incompatible versions. Toggle: show all, with incompatible versions clearly badged.
5. **Update-level dropdown (orthogonal axis).** Patch / Minor (default) / Major / Include prerelease.
6. **Vulnerability + deprecation badges.** From `dotnet package list --vulnerable` and `--deprecated`.
7. **Single-package update.** Click a version → run `dotnet add package <id> --version <v>`.
8. **Manual refresh.** Re-runs all queries. No background polling in v0.1.

### Out of scope for v0.1

- "Update All" button (needs careful TFM batching and conflict resolution — v0.2)
- Package search / install-new (v0.2)
- Package uninstall (v0.2)
- Solution-wide operations across multiple projects (v0.2)
- `Directory.Packages.props` / Central Package Management UI (v0.3)
- Private feed credential UI (defer to user's `nuget.config`; SDK handles it)
- Transitive dependency upgrade UI (rare, complex; v0.3+)
- License compliance checks (v0.4+)
- Background watch on `.csproj` changes (v0.2)
- Lock file (`packages.lock.json`) handling (v0.3)
- `packages.config` (legacy non-SDK projects) — explicit non-goal

## Stack

| Layer | Choice | Rationale |
|---|---|---|
| Language | TypeScript 5.x strict | Standard for VS Code extensions |
| Extension build | esbuild | Fast, simple config, official VS Code recommendation |
| Webview UI | React 18 + Vite | Familiar, well-supported, fast cold-start |
| Webview state | `useReducer` + `useContext` | One panel; no Redux/MobX needed |
| Tests (host) | Vitest | Fast, ESM-native |
| Tests (UI) | Vitest + React Testing Library | Component-level only; E2E via `@vscode/test-electron` |
| Lint/format | ESLint flat config + Prettier | Standard |
| Package manager | pnpm + workspaces | Per-package isolation, fast |
| CI | GitHub Actions | Win/Mac/Linux matrix, vsce publish on tag |

## Repo layout

```
nuget-compass/
├── docs/
│   ├── spec.md           ← this file
│   ├── research.md       ← empirical findings
│   ├── features.md       ← v0.1 + roadmap
│   └── ui-design.md      ← layout, controls, interaction
├── fixtures/
│   └── net8-mixed-versions/   ← test .NET 8 project, used in dev
├── packages/
│   ├── extension/        ← VS Code extension host (TS, esbuild)
│   ├── webview/          ← React UI (Vite)
│   └── shared/           ← TypeScript types shared across both
├── package.json          ← pnpm workspace root
├── pnpm-workspace.yaml
├── README.md
├── LICENSE
└── .gitignore
```

## Performance targets (v0.1)

- Cold open of a 10-project, 100-package workspace: first paint < 2s
- Per-package version-list expand: < 500ms with warm cache, < 3s cold
- TFM compatibility lookup: in-memory after first resolution; never blocks UI
- Manual refresh: < 5s for 100 packages with warm cache
- Memory ceiling: < 100MB for the extension process; webview < 50MB

## Caching strategy

Three tiers:

1. **In-memory** (per VS Code session): all SDK output, all catalog entries, resolved TFM compatibility decisions.
2. **Disk cache** (`globalStorageUri`): catalog entries keyed by `{id}@{version}`. Immutable — written once, never invalidated. Indexed JSON files in subdirectories (sharded by first letter of package ID to avoid huge directories).
3. **No cache for installed-state queries.** Always re-query the SDK. They're fast (sub-second) and stale data here causes user confusion.

## Failure modes

| Failure | Behavior |
|---|---|
| `dotnet` CLI not found | Banner: "Install .NET SDK 8.0+" with link. Extension does nothing else. |
| `dotnet` CLI < required version | Banner with version detected vs. required. |
| Workspace has no `.csproj`/`.fsproj`/`.vbproj` | Empty-state panel: "Open a folder containing a .NET project." |
| nuget.org unreachable | TFM filter degrades to "show all" with banner: "Compatibility data unavailable; showing all versions." Mutations still work. |
| `dotnet add package` returns NU1202 | Surface the SDK error verbatim in a notification. (This *should* be impossible if filter is on, but defense in depth.) |
| Catalog entry missing `dependencyGroups` (rare; some old packages) | Treat as "compatible with everything"; show with a "no compat data" badge. |
| Network timeout | Per-request 10s timeout; partial results shown with a re-query button. |

## Non-functional requirements

- **No telemetry in v0.1.** If added later, opt-in only with clear disclosure.
- **No external dependencies beyond .NET SDK and nuget.org.** No third-party APIs, analytics, license servers.
- **Offline-tolerant.** Installed-state view works without network; available-versions view shows cached data.
- **Cross-platform.** No Windows-specific paths, no shell-specific commands.

## Versioning strategy

- v0.1.x — MVP iterations; breaking changes allowed in settings/state shape
- v0.2.x — Update All + search + uninstall; settings stable
- v1.0.0 — Feature complete for "modern .NET project, single or solution-level"; SemVer enforced thereafter

## Success criteria for v0.1

- Open the included fixture project (net8.0, 13 packages) → see all 13 with current versions and project TFM in < 2s
- Default filter (TFM-compat + Minor) hides EF Core 10.0.7 and shows EF Core 8.0.x; shows `Microsoft.Extensions.Configuration` 8.0.x but not 10.x (because Major filter would be needed)
- Switching update-level to Major reveals `Microsoft.Extensions.Configuration` 10.0.7 with a "TFM compatible" badge, while EF Core 10.0.7 stays visible only when "show all" is on, with an "incompatible" badge
- Cross-platform CI green on Windows, macOS, Linux
- VSIX size < 5MB
- Installed package count of 0 on the extension's own dependencies (after bundling) — i.e., no runtime `node_modules` ships
