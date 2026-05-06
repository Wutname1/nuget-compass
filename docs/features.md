# Feature Set

All features below ship together as **v0.1.0** — the first public release. There are no separate v0.2/v0.3/v0.4 versions; the milestones below sequence the build-out, not separate releases.

Status legend: ✅ shipped · 🚧 in progress · ⬜ not started

---

## M1 — Scaffolding ✅

Build infrastructure. Not user-visible.

- pnpm workspace with three packages: `extension`, `webview`, `shared`
- TypeScript strict, esbuild for the host bundle, Vite + React 18 for the webview
- ESLint flat config, Prettier, EditorConfig
- VS Code `launch.json` + `tasks.json` for F5 debugging against the fixture
- Vitest for unit tests
- `vscode` mock under `src/__mocks__/` so tests don't need the extension host

## M2 — Project discovery & installed packages ✅

### F1. Project discovery

- Scan workspace for `*.csproj`, `*.fsproj`, `*.vbproj`
- Multi-project workspaces grouped by project
- Target framework extracted from `dotnet package list --format json` output (no custom csproj parser)
- Empty-state panel when no projects found
- Per-project failures isolated — a single bad csproj doesn't block the rest of the scan

### F2. Installed packages view

- Per project: list every top-level `<PackageReference>`
- Columns: package name, current version, resolved version, target framework badge, status badges
- Status badges: outdated (default), vulnerable (Low/Moderate/High/Critical), deprecated
- Transitive packages hidden by default; "Show transitive" toggle in panel header

## M3 — Available versions & target framework filtering ✅

### F3. Version dropdown per package

- Click a package row → expand inline panel with available versions
- All versions returned with target framework data inline (via NuGet v3 registration index/pages — see M5 for the bulk-fetch architecture)
- Each version row: version string, release date, target framework compatibility indicator, prerelease badge
- Click a version → triggers single-package update flow (M4)

### F4. Target framework compatibility filter

- Binary toggle in panel header: **Compatible only** (default) / **Show all**
- "Show all" mode badges incompatible versions in red with the required framework shown
- Never silently hides a version — incompatibility is always visible somehow

### F5. Update-level filter

- Dropdown in panel header. Three options plus an orthogonal checkbox:
  - **Patch only** — `1.2.3` → `1.2.x` where x > 3
  - **Minor allowed** (default) — `1.2.3` → `1.x.y` where x ≥ 2
  - **Major allowed** — `1.2.3` → `x.y.z` where x ≥ 1
  - **Include prerelease** — orthogonal checkbox, cuts across the three above
- Filter applies to the "newer version available" indicator AND the dropdown contents
- Changes apply instantly without re-fetching (filter on cached results)

## M4 — Vulnerability badges, deprecation badges, single-package update ✅

### F6. Vulnerability + deprecation indicators

- Vulnerability badge: severity (Low/Moderate/High/Critical) with tooltip showing GHSA URL
- Deprecation badge with reason (Legacy / CriticalBugs / Other) and replacement package if specified
- Both ride on `dotnet package list --vulnerable` / `--deprecated` JSON output
- No custom advisory database; trust SDK output

### F7. Single-package update

- Click a version → modal confirm → run `dotnet add package <id> --version <v>`
- Stream SDK output to a "Compass: NuGet" output channel
- On success: refresh the project to reflect the new resolvedVersion
- On NU1202 or other failure: surface the SDK error verbatim and open the output channel

## M5 — Target-framework-honest refresh ✅

Correctness fix on M3's refresh flow. The original implementation used `dotnet package list --outdated` for first-paint, which is target-framework blind — it would offer EF Core 10.0.7 to a net8.0 project until the user expanded the row. M5 replaces this with the same catalog-backed resolver used on expand, so the "→ X.Y.Z" arrow is correct from first paint.

- New `getPackageVersions(id)` on the catalog client: bulk fetch via NuGet v3 registration index + pages
- Three-tier cache: in-memory (per session), on-disk (per page, under `globalStorageUri` — shared across all workspaces and projects), index re-fetched per refresh to detect new versions
- `resolveNewestAllowed` — fast path used during refresh; same data as the expand-time resolver
- Removed `dotnet/outdated.ts` and `dotnet/packageSearch.ts`

## M6 — Polish: refresh affordances, project header badges, force-refresh ⬜

### F8. Manual refresh

- ✅ "Refresh" button in panel header
- ⬜ "Force refresh" action (Shift-click or context menu) — invalidates catalog cache for visible packages via `catalog.invalidate(id)`
- ⬜ Loading skeleton/spinner while cold catalog fetch is in flight (currently shows empty rows)
- ⬜ Per-project status text: "Loading X of Y packages…" while enrichment is in progress

### Project header enrichments

- ⬜ Outdated count badge: `3 updates`, clickable to scroll to first outdated package
- ⬜ Vulnerability summary icon when any package in the project has a vulnerability
- ⬜ Deprecation summary icon when any package is deprecated
- ⬜ Per-project empty-update state: "All packages up to date" when nothing passes filters

### Settings polish (F9)

Already shipped, expand if needed:

- `nuget-compass.updateLevel`: `"patch" | "minor" | "major"` (default `"minor"`)
- `nuget-compass.includePrerelease`: `boolean` (default `false`)
- `nuget-compass.tfmFilter`: `"compatible" | "all"` (default `"compatible"`)
- `nuget-compass.showTransitive`: `boolean` (default `false`)
- `nuget-compass.dotnetPath`: `string` (default empty — auto-detect)
- `nuget-compass.requestTimeoutMs`: `number` (default `10000`)
- `nuget-compass.maxConcurrentCatalogRequests`: `number` (default `8`)
- `nuget-compass.trace`: `boolean` (default `false`) — verbose subprocess + HTTP logging

### Output channel (F10)

Already shipped:

- Channel: "Compass: NuGet"
- All `dotnet` subprocess invocations and their stdout/stderr logged
- All HTTP requests to nuget.org logged at debug level (gated by `nuget-compass.trace`)

## M7 — Bulk update flow, package search, package uninstall ⬜

### Update All

- Multi-select rows or a single "Update All compatible" button
- Single confirm modal listing all proposed changes
- Run mutations sequentially, reporting per-package success/failure
- Rollback isn't a goal — partial failure leaves the project mid-update with a clear error list

### Package search & install-new

- "Search NuGet" panel below the project list (or a separate command)
- Backed by `dotnet package search <query> --format json`
- Result list shows current versions, target frameworks, vulnerability flags
- Install action runs `dotnet add package`

### Package uninstall

- Right-click on a row or context menu action: "Uninstall"
- Modal confirm including any transitive packages that will be released
- Runs `dotnet remove package <id>`

## M8 — Solution view, file watching, diff preview ⬜

### Solution-level view

- When workspace contains a `.sln`, aggregate package state across all projects
- "Common" panel showing packages that appear in multiple projects with version drift highlighted
- Per-project view remains the default

### Background watch on csproj/fsproj/vbproj changes

- VS Code `FileSystemWatcher` on project files
- Auto-refresh installed view when a project file changes (debounced)

### Diff preview

- Before any mutation (single update, Update All), show a diff panel of `<PackageReference>` changes
- Cancel button at the diff stage in addition to the modal confirm

## M9 — Central Package Management, lock files, transitive upgrades, preview SDKs ⬜

### Directory.Packages.props (Central Package Management)

- Detect `Directory.Packages.props` in the workspace
- Show CPM-mode UI: package versions resolved at the props file, not per-csproj
- Updates write to the props file
- Per-project rows show the inherited version and any local override

### packages.lock.json awareness

- Detect lock file presence per project
- Show locked badge on locked projects
- Updates run with `--use-lock-file` when present

### Transitive dependency upgrade

- Expert mode: show transitive packages (already supported via toggle)
- Allow forcing a transitive package version via project-level `<PackageReference>` injection
- Surface vulnerable transitives prominently — the most common use case

### Preview SDK channels

- Filter dropdown: hide preview/RC versions of .NET runtimes (`net10.0-preview`, etc.)
- Default: hide previews on stable LTS projects, show them on projects already targeting a preview

## M10 — Stretch ⬜

### License compliance view

- Audit installed packages, surface license expressions from catalog data
- Configurable allowlist/denylist per workspace
- Badge packages with disallowed licenses

### Package size / asset count

- Surface .nupkg size from catalog metadata
- Useful for spotting accidental heavyweight dependencies

### Release notes inline

- Pull `releaseNotes` field from catalog when present
- Show in a tooltip on the version dropdown

### Multi-feed UI

- When a workspace has multiple feeds in `nuget.config`, show a per-source filter
- Currently the SDK transparently merges feeds; this is purely a UI affordance

## M11 — Publish ⬜

- Marketplace publisher ID registration
- Marketplace listing: README screenshots, hero image, categories, keywords
- CI: GitHub Actions running `pnpm test` + `pnpm build` + `vsce package` on PRs; `vsce publish` on tag
- VSIX size budget enforced in CI (< 5 MB)
- README quickstart + screenshots
- CHANGELOG.md generated from milestone commits

---

## Explicit non-goals — ever

- **`packages.config` projects.** Legacy non-SDK style. Out of scope; users on that workflow are not the audience.
- **Visual Studio integration.** This is a VS Code extension. VS already has its own (broken) UI.
- **NuGet protocol implementation.** We use the SDK and the public API; we don't reimplement.
- **Lock-step with .NET preview SDKs.** Support N and N-1 LTS; previews are best-effort.
- **Telemetry collection.** Not in the product roadmap.
