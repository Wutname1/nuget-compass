# NuGet Compass — Extension UI Kit

## Overview
High-fidelity interactive prototype of the NuGet Compass VS Code extension panel webview.

## Files
- `index.html` — Full interactive prototype. Click rows to expand version lists, toggle filters, cycle states.

## Design Decisions
- Renders as a VS Code sidebar panel at ~320px width (typical sidebar)
- Uses Dark+ theme values by default (matches VS Code's dark theme)
- All colors from `--vscode-*` variables, simulated with Dark+ defaults
- Font stack mirrors VS Code UI font (Segoe UI / SF Pro / system-ui)
- Interactive: filter dropdowns change display, rows expand/collapse, badges update

## Screens Covered
1. Main package list (loaded state, multiple projects)
2. Expanded version list (inline below row)
3. Confirm update modal
4. Scanning/loading state
5. No projects empty state
6. SDK not found error banner

## Component Inventory
- `<AppHeader>` — title + refresh/settings buttons
- `<FilterBar>` — framework compatibility, update level, prerelease, transitive toggles
- `<StatusBanner>` — scanning/fetching/error/info
- `<ProjectGroup>` — collapsible project header with framework badge + package count
- `<PackageRow>` — name, version, update arrow, badges
- `<VersionList>` — expanded inline list with per-version framework compatibility
- `<ConfirmModal>` — update confirmation dialog
- `<EmptyState>` — no projects / SDK missing states
