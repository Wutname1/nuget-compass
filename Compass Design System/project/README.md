# NuGet Compass Design System

## Overview

**NuGet Compass** is a VS Code extension for managing NuGet packages in .NET Core / .NET 5+ projects, with first-class target framework compatibility filtering. It solves a well-known pain point: Visual Studio's NuGet UI offers "latest" versions regardless of framework compatibility, leading to `NU1202` failures.

**Tagline:** "NuGet for VS Code, with target framework filtering that actually works."

**Audience:** .NET Core / .NET 5+ developers using VS Code without C# Dev Kit. Cross-platform: Windows, macOS, Linux.

**Status:** Early development (v0.1.0 MVP in progress as of mid-2026).

## Sources

- **Codebase:** `spartanui-wow/nuget-compass` (private GitHub repo)
  - `packages/webview/src/` — React UI (Vite + TypeScript)
  - `packages/extension/src/` — VS Code extension host (esbuild + TypeScript)
  - `packages/shared/src/types/` — Shared TypeScript contracts
  - `docs/` — Spec, research, UI design, features
- No Figma files were provided. Design system is derived entirely from codebase + docs.

## Product Context

NuGet Compass is a **single-surface VS Code extension** — it lives as a panel in the Activity Bar sidebar. The entire UI is a webview (React 18 + Vite) rendered inside VS Code's webview API. There is no marketing website, no mobile app, no separate dashboard. The product IS the extension panel.

Key product areas:
1. **Package list** — grouped by project, shows installed packages with current/resolved versions
2. **Filter bar** — framework compatibility filter, update level (patch/minor/major), prerelease toggle, transitive toggle
3. **Version expand panel** — inline version list with per-version compatibility badges
4. **Status / error banners** — scanning, fetching, .NET SDK errors, network degraded
5. **Empty states** — no projects, SDK missing, network unavailable

---

## CONTENT FUNDAMENTALS

### Voice & Tone
- **Terse, technical, respectful of developer intelligence.** No hand-holding.
- **First person is avoided.** UI copy is instructional or descriptive, not conversational.
- **No emoji** anywhere in the UI (docs use emoji sparingly for structure only).
- **No exclamation points.** Everything is calm and matter-of-fact.
- **Errors are surfaced verbatim** — the SDK's raw output (e.g. `NU1202`) is shown directly. Don't paraphrase errors.
- **Sentence case** for labels, banners, and empty states. Title case for the product name only.
- **Compact labeling:** "Framework:" not "Target Framework:", "Update:" not "Update level:".

### Copy Examples
- Empty state: *"No .NET projects found in this workspace."*
- Sub-copy: *"Open a folder containing a `.csproj`, `.fsproj`, or `.vbproj` file."*
- Banner: *"Scanning .NET projects…"* / *"Fetching versions…"*
- Confirm modal: *"Update **Microsoft.EntityFrameworkCore** from `8.0.0` to `8.0.26`?"*
- Success toast: *"✓ Updated. [Show output]"*
- Network degraded: *"Compatibility data unavailable. Showing only the cached versions."*
- SDK not found: *"The .NET SDK was not found. NuGet Compass needs `dotnet` 8.0+ on PATH."*

### Casing rules
- Product name: **NuGet Compass** (both words capitalized, always)
- Commands: sentence case — "NuGet Compass: Open", "NuGet Compass: Refresh"
- Settings keys: camelCase under `nuget-compass.*`
- Technical terms like NU1202, `.csproj`, `dotnet` are always formatted as-is. Framework monikers (net8.0, net9.0) are shown verbatim.

### Tone modifiers by context
| Context | Tone |
|---|---|
| Empty states | Neutral, informational |
| Errors | Factual, verbatim SDK output preferred |
| Banners | Brief status updates, progressive (…) |
| Tooltips | One sentence, no period |
| Confirm modals | Precise version numbers, no ambiguity |

---

## VISUAL FOUNDATIONS

### Design Philosophy
NuGet Compass inherits **all visual decisions from VS Code's theming system**. There is intentionally no custom color palette — all colors are VS Code CSS variables. This means the extension works correctly in dark, light, and high-contrast themes automatically. The "brand accent" is `--vscode-charts-purple` (NuGet purple `#004880` maps to VS Code's purple).

### Color System
All colors are VS Code CSS variables. Key vars used:
- `--vscode-foreground` — primary text
- `--vscode-editor-background` — main background
- `--vscode-sideBar-background` — sidebar / filter bar background
- `--vscode-sideBarSectionHeader-background` — project group headers
- `--vscode-descriptionForeground` — muted/secondary text (version numbers, framework badges)
- `--vscode-textLink-foreground` — "newer version available" arrows, links
- `--vscode-widget-border` — dividers between sections
- `--vscode-dropdown-background/foreground/border` — filter bar selects
- `--vscode-toolbar-hoverBackground` — icon button hover (fallback: `rgba(128,128,128,0.15)`)
- `--vscode-list-hoverBackground` — package row hover (fallback: `rgba(128,128,128,0.08)`)
- `--vscode-textCodeBlock-background` — inline `<code>` blocks
- `--vscode-editorInfo-background/foreground` — info banners
- `--vscode-inputValidation-errorBackground/foreground/border` — error banners
- `--vscode-charts-purple` — accent (compass brand color)
- `--vscode-charts-yellow` / `-orange` / `-red` — vulnerability severity gradient

**Dark theme defaults (VS Code Dark+):**
- Background: `#1e1e1e`
- Sidebar: `#252526`
- Foreground: `#cccccc`
- Muted: `#858585`
- Link/accent: `#3794ff`
- Border: `#3c3c3c`

### Typography
- **Font family:** `var(--vscode-font-family)` — inherits VS Code UI font (typically Segoe UI on Windows, SF Pro on macOS, system-ui on Linux)
- **Editor font:** `var(--vscode-editor-font-family)` — used for `<code>` blocks, version numbers in expanded list, SDK output
- **Base font size:** `var(--vscode-font-size)` — typically 13px
- **Header title:** 0.95rem, weight 600, letter-spacing 0.02em
- **Filter labels:** 0.85rem
- **Package rows:** 0.85rem
- **Code snippets:** 0.9em of surrounding context, monospaced
- **Version numbers:** `font-variant-numeric: tabular-nums` for alignment
- No custom webfonts. Everything is system/VS Code fonts.

### Spacing & Layout
- **Base unit:** `0.75rem` (padding on rows and header)
- **Tight gaps:** `0.25rem` (icon button gaps), `0.35rem` (filter label gaps)
- **Section padding:** `0.5rem 0.75rem` (header, filter bar, banners)
- **Row padding:** `0.35rem 0.75rem` (package rows — dense, data-heavy)
- **Package row grid:** `1fr auto auto` — name grows, version + update badge are fixed-width
- **Indent for transitive:** `padding-left: 0.75rem`
- **Empty state:** `padding: 2rem 1rem`, centered text

### Visual Motifs
- **No decorative imagery.** No illustrations, gradients, textures, or background images.
- **No rounded card components** with shadows or borders — the UI is a flat list inside a sidebar.
- **Borders:** single-pixel, via `--vscode-widget-border`. Used as dividers only (bottom of sections).
- **Backgrounds:** flat solid fills using VS Code variables. No gradients.
- **Corner radii:** `3px` on icon buttons only. Everything else is `0` or browser default for form controls.
- **Shadows:** none. This is a sidebar panel, not a floating UI.
- **Animations:** Only expand/collapse for version list. Must respect `prefers-reduced-motion`.
- **Hover states:** background color change only — `--vscode-list-hoverBackground` on rows, `--vscode-toolbar-hoverBackground` on icon buttons.
- **Press states:** no custom press states (VS Code handles natively for form elements).
- **Focus indicators:** always visible (VS Code defaults handle this).

### Density
The UI is **high-density** — package rows are tight (`0.35rem` vertical padding, `0.85rem` font). This is intentional: developers need to scan many packages at a glance, similar to file tree views in VS Code.

### Iconography approach
- **Compass icon (SVG):** The single brand icon. Monochrome, `stroke="currentColor"`, follows VS Code icon conventions. Used in Activity Bar.
- **Refresh button:** Unicode `↻` character (not an icon font)
- **VS Code codicons:** `$(refresh)` used for command palette binding
- **Status badges:** Unicode characters + text — `✓`, `⚠`, `✗`, `↑`, `🪦`, `🔒`
- **Arrows:** `→` Unicode for "current → newest"
- **No icon font or sprite sheet.** The extension relies on VS Code's codicons for commands, unicode for inline indicators.

### Accessibility
- Full keyboard nav (arrow keys, Enter, Space, Esc)
- `aria-label` on all controls
- Color never sole signal — badges always combine icon + text
- Screen reader live regions for refresh/update outcomes
- `prefers-reduced-motion` respected for expand animations

---

## ICONOGRAPHY

### Compass Logo
- File: `assets/compass.svg`
- A 24×24 viewBox SVG: circle (`r=9`) with a diamond/compass-needle polygon (`16,8 13,13 8,16 11,11`)
- Monochrome — `stroke="currentColor"`, no fill
- `stroke-width: 1.6`, rounded line caps/joins — consistent with VS Code icon set style
- Used in: Activity Bar entry (`packages/extension/resources/compass.svg`)

### Inline Badge Icons
These are Unicode characters used as inline status indicators, not font icons:
| Symbol | Usage |
|---|---|
| `↻` | Refresh button in header |
| `↑` | "N updates available" badge |
| `→` | Version arrow (current → newest) |
| `✓` | Framework compatible badge, success toast |
| `⚠` | Vulnerability / warning |
| `✗` | Framework incompatible badge |
| `🪦` | Deprecated package badge |
| `🔒` | Prerelease badge |
| `ⓘ` | Info banner icon |

### VS Code Codicons
Used for toolbar commands registered in `package.json`:
- `$(refresh)` — refresh command icon in VS Code command palette / toolbar

### No third-party icon library is used. No SVG sprites. No PNG icons.

---

## FILE INDEX

```
/
├── README.md                    ← This file
├── SKILL.md                     ← Agent skill definition
├── colors_and_type.css          ← CSS vars for colors + typography
├── assets/
│   └── compass.svg              ← Brand logo (Activity Bar icon)
├── preview/                     ← Design system card previews
│   ├── colors-dark.html         ← Dark theme color palette
│   ├── colors-semantic.html     ← Semantic color roles
│   ├── type-scale.html          ← Typography specimens
│   ├── spacing-tokens.html      ← Spacing + border radius tokens
│   ├── badge-components.html    ← Status badge components
│   ├── filter-bar.html          ← Filter bar component
│   ├── package-row.html         ← Package row states
│   ├── banners.html             ← Status/error banners
│   └── empty-states.html        ← Empty state screens
└── ui_kits/
    └── extension/
        ├── README.md            ← UI kit documentation
        └── index.html           ← Interactive prototype of the extension panel
```

---

*Design system derived from: `spartanui-wow/nuget-compass` (private), docs/, packages/webview/src/styles.css, and UI design spec in docs/ui-design.md.*
