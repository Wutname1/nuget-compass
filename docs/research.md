# Research Results

Empirical findings backing the architectural decisions in [`spec.md`](spec.md). Everything here was verified against real `dotnet` SDK output and the live NuGet v3 API.

## 1. The bug, reproduced

**Setup:** `fixtures/net8-mixed-versions/TestApp.csproj` — a `net8.0` console project with 13 deliberately outdated packages spanning Microsoft, ecosystem (Serilog, Polly, AutoMapper, MediatR, FluentValidation), data (EF Core, Dapper), serialization (Newtonsoft, System.Text.Json), and testing (xUnit).

**Test:** `dotnet add package Microsoft.EntityFrameworkCore --version 10.0.7` (the "latest" reported by the SDK and by Visual Studio).

**Result:**

```
error: NU1202: Package Microsoft.EntityFrameworkCore 10.0.7 is not compatible
       with net8.0 (.NETCoreApp,Version=v8.0). Package Microsoft.EntityFrameworkCore
       10.0.7 supports: net10.0 (.NETCoreApp,Version=v10.0)
```

This is the exact failure mode the extension is designed to prevent. Default `dotnet package list --outdated` reports `latestVersion: "10.0.7"` for EF Core with no compatibility hint.

## 2. The .NET SDK is partly useful — and has gaps

### What works

| Need | Command | Quality |
|---|---|---|
| Installed packages with current/resolved/requested versions | `dotnet package list --format json` | ✅ Perfect, includes project TFM |
| Vulnerability scan with severity + advisory URL | `dotnet package list --vulnerable --format json` | ✅ Excellent |
| Deprecation scan | `dotnet package list --deprecated --format json` | ✅ Free win |
| Full version enumeration for a specific package | `dotnet package search <id> --exact-match --format json` | ✅ Returns all ~80+ versions |
| Mutations (install/upgrade/remove) | `dotnet add package`, `dotnet remove package` | ✅ Already TFM-aware — refuses NU1202 at install time |
| Private feed authentication | Implicit via `nuget.config` + credential providers | ✅ Free; no UI work needed in v0.1 |

### What doesn't work

**The single critical gap: per-version TFM compatibility.** No SDK command tells you "of the 80 versions of `Microsoft.Extensions.Configuration`, which ones target `net8.0`?"

Two flag combinations were tested as proxies:

**`--outdated` (default):** TFM-blind. Reports the absolute latest, regardless of compatibility. This is the bug.

**`--outdated --highest-minor`:** Stays within the current major version. Looks safe at first glance — and for *Microsoft* packages it accidentally is, because Microsoft aligns major versions with .NET releases. But:

- ❌ For third-party packages (AutoMapper, Serilog, MediatR), "highest minor" has no relationship to TFM. AutoMapper 13/14/15/16 might still target `net8.0`; we can't tell from this flag alone.
- ❌ Silently *drops* packages that only have major-version updates. AutoMapper 12 → 16 just disappears from output. The user never learns the update exists.
- ❌ **Surprise empirical finding:** `Microsoft.Extensions.Configuration` is missing entirely from `--highest-minor` output despite being present in default `--outdated`. Looks like an SDK quirk we'd have to defensively handle.

**`--highest-patch`:** Useful for "show me only the safest possible bumps" but the same false-negative problem — many genuinely safe TFM-compatible upgrades cross minor boundaries and would be hidden.

### Surprise finding: not every `latestVersion` is the bug

Initially assumed all `Microsoft.Extensions.*` 10.0.7 packages were `net10.0`-only. Wrong:

```
$ curl ... registration5-semver1/microsoft.extensions.configuration/10.0.7.json
  → catalogEntry.dependencyGroups:
    .NETFramework4.6.2
    net8.0
    net9.0
    net10.0
    .NETStandard2.0
```

`Microsoft.Extensions.Configuration 10.0.7` multi-targets and is **fully compatible with net8.0**. A net8.0 user *should* take this update — but `--highest-minor` would tell them only `8.0.0 → 8.0.1` is available, and the default `--outdated` would offer `10.0.7` without telling them whether it's safe.

By contrast, `Microsoft.EntityFrameworkCore 10.0.7` has a single `dependencyGroup: net10.0` — single-targeted, genuinely incompatible with net8.0.

**Both packages have the same `latestVersion: 10.0.7` in SDK output.** Only the catalog data tells them apart. This is why TFM filtering must be a first-class concern, not a heuristic on version numbers.

## 3. The NuGet v3 API gives us what the SDK doesn't

Per-version TFM data lives in NuGet's catalog:

```
GET https://api.nuget.org/v3/registration5-semver1/{id-lowercase}/{version}.json
  → { "catalogEntry": "...catalog0/data/{date}/{id}.{version}.json" }

GET <catalogEntry>
  → {
      "id": "Microsoft.EntityFrameworkCore",
      "version": "10.0.7",
      "dependencyGroups": [
        {
          "targetFramework": "net10.0",
          "dependencies": [...]
        }
      ]
    }
```

Each `dependencyGroups[].targetFramework` is a TFM string we can resolve against the project's framework using a NuGet TFM compatibility table.

**Caching is mandatory.** Per-version catalog entries are immutable (the URL embeds a date) — they can be cached forever. A naive implementation that fetches all 80 versions of every package on every refresh will be hostile to nuget.org and slow for users.

## 4. TFM compatibility is non-trivial but bounded

NuGet's framework compatibility logic isn't simple substring matching. `net8.0` accepts:

- `net8.0` (exact)
- `net7.0`, `net6.0`, `net5.0` (older net moniker generations are mostly forward-compatible)
- `netcoreapp3.1`, `netcoreapp3.0`, `netcoreapp2.x`, `netcoreapp1.x`
- `netstandard2.1`, `netstandard2.0`, `netstandard1.6` and older
- Some `net4.x` cases via shims (rare in modern projects)

The full table is ~30 frameworks with a partial-order compatibility relation. Two implementation options:

1. **Ship a static compat table** in the extension. Small, stable, no subprocess overhead, cross-platform. NuGet's own table changes maybe once per .NET release.
2. **Shell out to `dotnet`** somehow. Possible but no clean public CLI surface for "is X compat with Y" — would need to fake a project and read restore output. Slow and fragile.

**Decision: ship the table.** Audit annually as new .NET versions ship.

## 5. Update-level filter (user request)

Even with TFM filtering, users don't want every compatible version surfaced as "you should update." Many shops want to stay on patch-only updates between sprints. So the filter has two orthogonal axes:

**Axis 1 — TFM compatibility (binary):**
- Compatible only (default)
- Show all (with incompatibility marked, never silently included)

**Axis 2 — Update level (dropdown):**
- Patch only (`X.Y.Z` → `X.Y.Z+n`)
- Minor allowed (`X.Y.*` → `X.Y+n.*`) — default
- Major allowed (`X.*` → `X+n.*`)
- Include prerelease (cuts across all three)

Combined, these handle the cases:
- Conservative team mid-sprint: TFM-compatible + Patch only
- Routine maintenance: TFM-compatible + Minor allowed (default)
- Active modernization: TFM-compatible + Major allowed
- Compatibility audit: Show all + Major allowed

## 6. Vulnerability and deprecation are nearly free

`dotnet package list --vulnerable --format json` returns severity (`Low`/`Moderate`/`High`/`Critical`) and a GHSA advisory URL per package. `--deprecated` returns deprecation reasons.

In our test project, both AutoMapper 12.0.1 and System.Text.Json 8.0.0 came back as `High` severity. Cost to surface in UI: two extra subprocess calls and a badge per row. Worth including in v0.1.

## 7. Architectural conclusion

**Hybrid engine.** Neither pure-SDK-wrapper nor pure-NuGet-API-client works:

```
.NET SDK (subprocess)              NuGet v3 catalog (HTTP, cached)
──────────────────────             ──────────────────────────────
• Project enumeration              • Per-version dependencyGroups
• Installed packages + TFM         • TFM list per version
• Vulnerability data
• Deprecation data
• Version list per package
• Install/uninstall/upgrade

           ┌──────────────────┴──────────────────┐
                            │
              TFM compatibility resolver (in-extension)
                            │
                  Update-level filter (per-user)
                            │
                          Webview
```

This split also means the extension degrades gracefully if nuget.org is unreachable — the SDK-driven views still work; only TFM filtering loses precision.

## 8. Why not fork an existing extension

The leading candidate (`aliasadidev/vscode-npm-gui`, MIT, last release Sept 2024) was inspected. Findings:

- TFM string appears only in test fixture XML; no production code reads `<TargetFramework>` from csproj
- `Project` model has no framework field; threading TFM through requires changing the model, parser, IPC contract, and version logic
- Version "latest" logic is a 14-line regex sort with no compatibility concept
- NuGet client uses flat-container endpoint (no per-version TFM data); switching to registration v3 is a non-trivial rewrite
- Webview uses Angular 12 (EOL), needing a framework upgrade as the first commit
- Multi-feed auth is genuinely good, but doesn't include modern device-flow / credential-provider patterns we get free from the .NET SDK

Going greenfield avoids inheriting a dated foundation while losing nothing the SDK doesn't already provide.
