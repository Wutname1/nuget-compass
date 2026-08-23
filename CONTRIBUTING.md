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

**The subject line IS the changelog entry.** An automated changelog walks
`git log` between release tags, strips the prefix, and publishes the rest
verbatim to end users. Nobody rewrites it later.

**Who reads it:** someone with no idea this codebase exists and no interest in
it - a middle schooler, or a math teacher who does not care how any of it works.
They want one thing: **what bug, feature, or annoyance just got fixed or
improved?** They are not impressed by the hard part. They do not know what a
component is. They will never read the body.

So the question before committing is never "does this describe the change?" It
is **"would that person know what changed for them?"** Write it in everyday
words - what they can now do, or what stopped going wrong. Every technical
detail (component names, APIs, file paths, the how) goes in the body.

**Never put these in a subject line:** component or class names
(`InlineComposer`, `AuraContainer`), API or function names, file paths, internal
jargon ("rehydration", "debounce", "memoize", "state driver", "keyboard-aware"),
adjective piles that describe the code instead of the effect, or the names of
other apps and addons.

**Rewrites - the left column is what NOT to write:**

| Don't | Do |
| --- | --- |
| `new: Keyboard-aware inline club composer rises above keyboard` | `new: The keyboard no longer covers the box you type in` |
| `fixes: Debounce progress sync to avoid race on cold reload` | `fixes: Stop losing your place when the app restarts` |
| `improved: Refactor AuraContainer to use declarative filters` | `improved: Buff icons update faster and use less memory` |
| `new: Add RatingPromptActions component to notification tray` | `new: Rate a book right after you finish it` |
| `fixes: Null-guard getBookByMediaId in absdb resolver` | `fixes: Books missing from your library no longer break the page` |

Two tests. Read the subject to someone who does not code: if they ask "what does
that mean?", it is not ready. And if it names something they have never seen on
their own screen, it is not ready.

The body is for technical detail and file references.

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
