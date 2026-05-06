# Feature Set

## v0.1.0 — MVP (target: ~6 weekends)

### F1. Project discovery
- Scan workspace for `*.csproj`, `*.fsproj`, `*.vbproj`
- Multi-project workspaces grouped by project
- TFM extracted from `dotnet package list --format json` output (no custom parser)
- Empty-state panel when no projects found

### F2. Installed packages view
- Per project: list every top-level `<PackageReference>`
- Columns: package name, current version, resolved version, TFM badge, status badges
- Status badges: outdated (default), vulnerable (high/critical/moderate/low), deprecated
- Transitive packages hidden by default; "Show transitive" toggle in panel header

### F3. Version dropdown per package
- Click a package row → expand inline panel with available versions
- Lazy-load: SDK enumeration on first expand, then NuGet catalog calls per version (parallel, capped at 8 concurrent)
- Each version row: version string, release date, TFM compatibility indicator, vulnerability flag if known
- Cached aggressively (catalog entries are immutable)

### F4. TFM compatibility filter
- Binary toggle in panel header: **Compatible only** (default) / **Show all**
- "Show all" mode badges incompatible versions in red with the offending TFM(s) shown
- Never silently hides a version — incompatibility is always visible somehow

### F5. Update-level filter
- Dropdown in panel header. Four options:
  - **Patch only** — `1.2.3` → `1.2.x` where x > 3
  - **Minor allowed** (default) — `1.2.3` → `1.x.y` where x ≥ 2
  - **Major allowed** — `1.2.3` → `x.y.z` where x ≥ 1
  - **Include prerelease** — separate checkbox, cuts across the three above
- Filter applies to the "newer version available" indicator AND the dropdown contents
- Changes apply instantly without re-fetching (filter on cached results)

### F6. Vulnerability + deprecation indicators
- Vulnerability badge: severity (Low/Moderate/High/Critical) with tooltip showing GHSA URL
- Deprecation badge with reason (legacy / criticalBugs / other) and replacement package if specified
- Both ride on `dotnet package list --vulnerable` / `--deprecated` JSON output
- No custom advisory database; trust SDK output

### F7. Single-package update
- Click a version → confirm modal → run `dotnet add package <id> --version <v>`
- Stream SDK output to a "Compass: NuGet" output channel
- On success: refresh the package row inline (don't re-scan whole workspace)
- On NU1202 or other failure: surface the SDK error in a notification and leave state as-is

### F8. Manual refresh
- "Refresh" button in panel header (icon + keybind)
- Re-runs SDK queries; preserves catalog cache
- "Force refresh" (Shift-click or context menu): also invalidates catalog cache for visible packages

### F9. Settings
Stored under `nuget-compass.*` in user/workspace settings:

- `nuget-compass.updateLevel`: `"patch" | "minor" | "major"` (default `"minor"`)
- `nuget-compass.includePrerelease`: `boolean` (default `false`)
- `nuget-compass.tfmFilter`: `"compatible" | "all"` (default `"compatible"`)
- `nuget-compass.showTransitive`: `boolean` (default `false`)
- `nuget-compass.dotnetPath`: `string` (default empty — auto-detect)
- `nuget-compass.requestTimeoutMs`: `number` (default `10000`)
- `nuget-compass.maxConcurrentCatalogRequests`: `number` (default `8`)

Per-panel state (filter selections) persists per-workspace via `Memento`.

### F10. Output channel
- Channel: "Compass: NuGet"
- All `dotnet` subprocess invocations and their stdout/stderr logged
- All HTTP requests to nuget.org logged at debug level (gated by `nuget-compass.trace` setting; default off)

## v0.2.0 — Workflow completion (post-MVP)

| Feature | Reasoning |
|---|---|
| Update All button | Top requested feature; needs careful TFM-aware batching |
| Package search and install-new | Mirror Visual Studio's "Browse" tab |
| Package uninstall | `dotnet remove package <id>` |
| Solution-level view | Aggregate across all projects in a `.sln` |
| Background watch on `.csproj` changes | Auto-refresh installed view when csproj changes |
| Diff preview before update | Show what versions will change before committing |
| Update plan export | Copy a list of `dotnet add package` commands to clipboard |

## v0.3.0 — Modern .NET ergonomics

| Feature | Reasoning |
|---|---|
| `Directory.Packages.props` (Central Package Management) | Common in real .NET shops; needs distinct UI mode |
| `packages.lock.json` awareness | Show locked vs. unlocked state |
| Transitive dependency upgrade UI | Expert mode; useful when transitive vulns appear |
| Preview SDK channels | Filter packages by .NET preview vs. RTM |

## v0.4.0+ — Stretch

| Feature | Reasoning |
|---|---|
| License compliance view | Audit installed packages for license types |
| Package size / asset count | Surface impact of large packages |
| Release notes inline | Pull from package README / NuGet metadata |
| Multi-feed UI | Display per-source filtering (currently SDK transparently merges) |

## Explicit non-goals — ever

- **`packages.config` projects.** Legacy non-SDK style. Out of scope; users on that workflow are not the audience.
- **Visual Studio integration.** This is a VS Code extension. VS already has its own (broken) UI.
- **NuGet protocol implementation.** We use the SDK and the public API; we don't reimplement.
- **Lock-step with .NET preview SDKs.** Support N and N-1 LTS; previews are best-effort.
- **Telemetry collection.** Not in the product roadmap.
