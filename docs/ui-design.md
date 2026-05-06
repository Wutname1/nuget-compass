# UI Design

## Surface

Single VS Code Webview panel registered as a view in the Activity Bar.

- **Activity Bar icon:** Compass rose (custom SVG, monochrome, follows VS Code icon conventions)
- **View container:** "NuGet Compass"
- **View ID:** `nuget-compass.packages`
- **Open command:** `nuget-compass.open` (palette: "NuGet Compass: Open")

## Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  NuGet Compass                                       [↻] [⚙]   │  ← Header
├─────────────────────────────────────────────────────────────────┤
│  Filter:  [TFM: Compatible ▾]  [Update: Minor ▾]  ☐ Prerelease │  ← Filter bar
│           ☐ Show transitive                                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ▼ TestApp (net8.0)                                             │  ← Project group
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ AutoMapper                12.0.1  →  12.0.1  ⚠ High vuln │  │  ← Package row
│  │ Dapper                    2.1.21  →  2.1.72             │  │
│  │ FluentValidation          11.8.0  →  11.12.0            │  │
│  │ MediatR                   12.2.0  →  12.5.0             │  │
│  │ Microsoft.EntityFrameworkCore                             │  │
│  │                            8.0.0  →  8.0.26             │  │
│  │ Microsoft.Extensions.Configuration                        │  │
│  │                            8.0.0  →  10.0.7  ✓ TFM ok   │  │  ← Major-allowed mode
│  │ ...                                                       │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ▶ AnotherProject (net9.0)                                      │  ← Collapsed project
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Components

### Header bar

- **Title:** "NuGet Compass"
- **Refresh button (↻):** Re-runs all SDK queries. Spinner overlay during refresh. Shift-click invalidates catalog cache for visible packages.
- **Settings button (⚙):** Opens VS Code settings filtered to `nuget-compass.*`.

### Filter bar

Sticky at top of the scrollable area. Three controls:

#### TFM compatibility selector
Dropdown, two options:
- **Compatible** (default) — only versions that target the project's TFM are surfaced as updates
- **Show all** — every version surfaces; incompatible ones get a red "✗ {tfm}" badge

#### Update level selector
Dropdown, three options:
- **Patch only** — same major.minor, newer patch
- **Minor allowed** (default) — same major, newer minor or patch
- **Major allowed** — any newer version

#### Prerelease checkbox
Orthogonal to the dropdown. When on, prerelease versions appear; when off, they're hidden everywhere.

#### Show transitive checkbox
When on, transitive dependencies appear under each top-level package, indented and with a "transitive" muted badge. v0.1 does not allow updating transitives directly.

### Project group

Collapsible header showing:
- Project name (file basename without extension)
- TFM badge in `().` style: e.g., `(net8.0)` or `(net8.0; net9.0)` for multi-targeted
- Outdated count: `3 updates` (clickable, scrolls to first outdated package)
- Status icons: 🛡 if any vulnerable, ⚠ if any deprecated

Expands to show package rows. State persists per-workspace.

### Package row

```
PackageName              CurrentVersion  →  NewestAllowed   [badges]
```

- **Click row:** expand version list inline
- **Hover row:** highlight, show full path tooltip (`Microsoft.Extensions.Configuration` may be ellipsized)
- **Right-click row:** context menu
  - Copy package name
  - Copy `<PackageReference>` snippet
  - Open on nuget.org
  - View dependencies
  - Force-refresh this package

#### Status badges (right-aligned)

| Badge | Meaning | Color |
|---|---|---|
| `↑ N updates` | N versions newer than current pass current filters | foreground accent |
| `✓ TFM ok` | Newest allowed is TFM-compatible (only shown in "Major allowed" + multi-targeted case for clarity) | foreground subtle |
| `⚠ {severity}` | Vulnerability badge; severity from SDK (Low/Mod/High/Critical) | yellow → red gradient by severity |
| `🪦 deprecated` | Marked deprecated; tooltip shows reason and replacement | gray |
| `✗ {tfm}` | Incompatible; only when "Show all" is on | red |
| `🔒 prerelease` | Newest allowed is a prerelease | blue |

Multiple badges stack horizontally in fixed order: vuln, deprecation, prerelease, TFM-status.

### Expanded version list

Below the package row, indented:

```
  └─ Available versions:
       12.0.1 (current)
       13.0.0  ✗ net10.0   2025-08-14
       12.5.0                2024-11-02   ← clickable, click to update
       12.4.1                2024-09-10
       12.3.0                2024-06-22
       ...
       [Show all 80 versions]
```

- **Default rows shown:** up to 10 most recent passing the filter
- **"Show all" link:** expands to full list (lazy-loaded if needed)
- **Click a version:** confirm modal → run `dotnet add package`
- **Hover a version:** tooltip shows release date, download count (from catalog), TFMs supported
- **Current version:** muted, marked `(current)`, not clickable
- **Incompatible versions in "Show all" mode:** strike-through with `✗` badge

### Confirm modal (single-package update)

Native VS Code modal:
> Update **Microsoft.EntityFrameworkCore** from `8.0.0` to `8.0.26`?
>
> [Cancel] [Update]

After update succeeds, an inline toast at the bottom of the row:
> ✓ Updated. [Show output]

### Output channel

VS Code Output panel, named "Compass: NuGet". All `dotnet` invocations logged with command and stdout/stderr. Trace HTTP requests behind a setting.

## Empty / loading / error states

### Loading (initial scan)
Centered spinner with text:
> Discovering .NET projects…

### No projects
Centered illustration + text:
> No .NET projects found in this workspace.
>
> Open a folder containing a `.csproj`, `.fsproj`, or `.vbproj` file.

### .NET SDK not installed
Banner at top of panel, dismissible:
> ⚠ The .NET SDK was not found. NuGet Compass needs `dotnet` 8.0+ on PATH.
> [Get the .NET SDK]

### Network unavailable / nuget.org down
Subtle banner under the filter bar:
> ⓘ Compatibility data unavailable. Showing only the cached versions.

Existing cached catalog data still flows through the filter; install/uninstall still works.

## Theming

- Colors via VS Code CSS variables only: `--vscode-foreground`, `--vscode-editor-background`, `--vscode-textLink-foreground`, etc.
- No custom palette. Inherits dark/light/high-contrast automatically.
- Accent color for "compass": `--vscode-charts-purple` (NuGet purple is `#004880`; VS Code's purple is close enough that we shouldn't override).
- Severity colors map to `--vscode-charts-yellow` / `-orange` / `-red`.

## Accessibility

- Full keyboard navigation: arrow keys move between rows, Enter expands version list, Space toggles, Esc collapses.
- All controls labelled with `aria-label`.
- Color is never the sole signal: badges combine icon + text, status uses both color and shape.
- Focus indicators visible at all times.
- Screen reader live region for refresh progress and update success/failure.
- Respects `prefers-reduced-motion` (disable expand animations).

## Interaction principles

- **No silent dropping.** A version that's incompatible or outside the update level is *visibly* hidden; the user can switch modes and see it. Never just disappear.
- **Filter changes are instant.** No re-fetch; we filter the cached version set in memory.
- **Refresh is explicit.** No background polling that could surprise the user.
- **Mutations are confirmed.** No accidental upgrades from a misclick. (Bulk operations in v0.2 will use a single confirm with a list.)
- **Errors are surfaced verbatim.** When the SDK fails, show its message — don't paraphrase. Developers know how to read NU1202.

## Out of scope for v0.1 UI

- Multi-select rows (v0.2 with Update All)
- Drag to reorder projects (no clear use case)
- Inline release notes (v0.4)
- Charts / graphs (no use case at MVP)
- Custom themes (inherit VS Code's)
