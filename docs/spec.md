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

## v0.1.0 scope

Everything in [`features.md`](features.md) ships as v0.1.0. Milestones M1 through M11 sequence the build; there are no separate v0.2/v0.3/v0.4 releases. See `features.md` for the full milestone breakdown and current status.

The ever-non-goals are listed at the bottom of `features.md` and mirrored here:

- **`packages.config` projects** (legacy non-SDK style) — out of scope; users on that workflow are not the audience
- **Visual Studio integration** — this is a VS Code extension; VS already has its own (broken) UI
- **NuGet protocol reimplementation** — we use the SDK and the public v3 API
- **Lock-step with .NET preview SDKs** — support N and N-1 LTS; previews are best-effort
- **Telemetry collection** — not in the product roadmap
- **Private feed credential UI** — deferred to the user's `nuget.config`; the SDK handles auth transparently

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

## Performance targets

- Cold open of a 10-project, 100-package workspace: first paint < 2s
- Per-package version-list expand: < 500ms with warm cache, < 3s cold
- TFM compatibility lookup: in-memory after first resolution; never blocks UI
- Manual refresh: < 5s for 100 packages with warm cache
- Memory ceiling: < 100MB for the extension process; webview < 50MB

## Caching strategy

Three tiers:

1. **In-memory** (per VS Code session): the full version list per package, including target framework data. Keyed by lowercased package id.
2. **Disk cache** (`globalStorageUri`, shared across all workspaces and projects): NuGet v3 registration pages, sharded by first character of package id. Pages are immutable except for the page containing the highest version, which is re-validated against the registration index's `commitTimeStamp` on each refresh.
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

- **No telemetry.** If considered later, opt-in only with clear disclosure.
- **No external dependencies beyond .NET SDK and nuget.org.** No third-party APIs, analytics, license servers.
- **Offline-tolerant.** Installed-state view works without network; available-versions view shows cached data.
- **Cross-platform.** No Windows-specific paths, no shell-specific commands.

## Versioning strategy

- 0.x.y — pre-public versions used during M1–M10 build-out; breaking changes allowed in settings shape
- 1.0.0 — first marketplace release after M11; SemVer enforced thereafter

## Success criteria for v0.1.0 release

- Open the included fixture project (net8.0, 13 packages) → see all 13 with current versions and project target framework in < 2 seconds
- Default filter (Compatible + Minor) shows EF Core 8.0.x updates and hides incompatible 10.x; shows `Microsoft.Extensions.Configuration` 8.0.x updates
- Switching update-level to Major reveals `Microsoft.Extensions.Configuration` 10.0.7 (multi-target — compatible with net8.0); EF Core 10.0.7 stays hidden unless "Show all" is also on, where it appears with an "incompatible" badge
- Cross-platform CI green on Windows, macOS, Linux
- VSIX size < 5 MB
- Zero runtime `node_modules` shipped — all dependencies bundled by esbuild/Vite
