<p align="center">
  <img src="heroimage.png" alt="NuGet Compass" />
</p>

# nuget-compass

A VS Code extension for managing NuGet packages in .NET Core / .NET 5+ projects, with first-class **target framework (TFM) compatibility filtering**.

**Marketplace:** [Wutname1.nuget-compass](https://marketplace.visualstudio.com/items?itemName=Wutname1.nuget-compass)

> ⚠️ **Early testing.** This extension is in early testing and the API, settings, and UI may change without notice. Bug reports and feedback are very welcome.

## Why this exists

Default NuGet package manager UIs show the "latest" version of every package regardless of whether it actually targets your project's framework. On a `net8.0` project, you'll see `net10.0`-only packages offered as updates, and "Update All" happily tries to install them — usually resulting in `NU1202: Package X is not compatible with net8.0`.

`nuget-compass` is built around the assumption that **every version offered to you should be one you can actually install**.

## Status

Early testing. Repo: [Wutname1/nuget-compass](https://github.com/Wutname1/nuget-compass).

## Repo layout

```
nuget-compass/
├── fixtures/   # Test .NET projects used during development
└── packages/   # Source code (pnpm workspace)
```

## License

MIT — see [LICENSE](LICENSE).
