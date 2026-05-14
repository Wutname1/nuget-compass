# Contributing to NuGet Compass

Thanks for your interest in improving NuGet Compass. This document covers the
local dev setup, the commands you'll use most, and the conventions the
codebase follows.

## Prerequisites

- **Node.js 20+** (the workspace requires `engines.node >= 20`)
- **pnpm 10.x** (this repo's `packageManager` pins the exact version; install
  globally with `npm i -g pnpm` or use Corepack: `corepack enable`)
- **.NET SDK 8 or newer** — the extension shells out to `dotnet` for every
  scan, restore, and `package add/remove`. Without it, nothing works.
- **VS Code 1.95+** for the Extension Development Host (`F5` to launch).

Clone, then install once at the repo root:

```sh
pnpm install
```

## Repository layout

```text
nuget-compass/
├── fixtures/                 # .NET sample projects used to exercise the extension
│   ├── net8-mixed-versions/
│   ├── net10-graphql-api/
│   ├── net10-hangfire-web/
│   └── net10-keycleanup-job/
└── packages/                 # pnpm workspace
    ├── extension/            # VS Code extension host (Node, runs dotnet)
    ├── shared/               # IPC types shared between host and webview
    └── webview/              # React UI rendered inside the panel
```

The host and webview communicate via the discriminated-union messages in
`packages/shared/src/types/messages.ts`. **Add new message kinds to that union
first**, then handle them on both ends — the TypeScript exhaustiveness check
will catch anything you miss.

## Common commands

All commands run from the repo root and fan out to every workspace package.

```sh
# One-time install
pnpm install

# Run every check the CI cares about (typecheck + lint + tests + build)
pnpm typecheck
pnpm lint
pnpm test
pnpm build

# Fast feedback while editing
pnpm dev          # parallel watchers across all packages

# Clean intermediate output
pnpm clean
```

### Running tests

```sh
pnpm test
```

That runs `vitest run` inside `packages/extension`. The suite covers semver
parsing, target-framework compatibility, the `dotnet package list` JSON
parsers, the NuGet catalog client, vulnerability/deprecation scans, and the
NU-code diagnostics parser.

To iterate on a single test file:

```sh
pnpm --filter @nuget-compass/extension exec vitest run src/dotnet/diagnostics.test.ts

# Watch mode while editing
pnpm --filter @nuget-compass/extension exec vitest src/dotnet/diagnostics.test.ts
```

### Trying changes in a real VS Code window

1. Run `pnpm build` (or leave `pnpm dev` running for watch mode).
2. Open the repo in VS Code and press `F5`. The Extension Development Host
   launches with NuGet Compass loaded.
3. Open one of the `fixtures/*` directories as the workspace to exercise
   different .NET versions and package-state scenarios.

After webview changes, you can usually click the refresh button inside the
panel rather than relaunching the Extension Development Host. After host-side
changes, reload the dev host window (`Ctrl+R` / `Cmd+R`).

## Code style

- **TypeScript everywhere.** No `any` without a comment explaining why.
- **No `console.log`.** Use the `logger` in `packages/extension/src/logging/`
  — every call lands in the Activity tab and the `Compass: NuGet` output
  channel automatically. Tag entries with a `category` and `context` when
  relevant.
- **Errors at boundaries.** Don't catch internal errors only to rewrap them.
  Catch where the user-visible message needs to be produced (a webview post
  or an `showErrorMessage` call) and let everything else bubble.
- **Diagnostic fixes go through `NuFix`.** New NU-codes should produce a
  `NuDiagnostic` with a `fix` if the extension can resolve them. Pattern
  examples live in `packages/extension/src/dotnet/diagnostics.ts`.

## Commit messages

Commit summaries are user-facing — they flow through to the marketplace
changelog. Use a prefix that classifies the change:

- `new:` — completely new feature
- `improved:` — enhancement to existing behavior
- `fixes:` — bug fix

The first line should read at a 6th-grade level ("what changed for me?").
The body is for technical detail and file references. See `git log` for the
established tone.

Do **not** push directly to `master` — push triggers the release workflow.
Open a PR; a maintainer will merge.

## Reporting bugs

Open an issue at <https://github.com/Wutname1/nuget-compass/issues>. Include:

- VS Code version + OS
- `dotnet --info` output
- The relevant slice of the Activity tab (or the `Compass: NuGet` output
  channel)
- A minimal `.csproj` if the bug is project-specific

## License

By contributing you agree your work is released under the project's MIT
license (see `LICENSE`).
