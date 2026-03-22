# DotNet Crunch

**Continuous testing engine for C#/.NET** — inspired by NCrunch.

DotNet Crunch runs your tests automatically as you code, shows per-line coverage in the gutter, and uses **impact analysis** to only re-run the tests that matter. No buttons to press, no context switching — just instant feedback.

![DotNet Crunch](media/icon.png)

---

## Features

### 🔴🟢 Gutter Markers — Per-Line Coverage

Every line of your C# code gets a colored dot in the gutter:

- **Green** — Covered by passing tests
- **Red** — Covered by at least one failing test
- **Gray** — Executable code not covered by any test

Hover over any dot to see exactly which tests cover that line, their pass/fail status, and execution time.

### ⚡ Impact Analysis — Only Run What Matters

When you save a file, DotNet Crunch doesn't re-run your entire test suite. It uses a **coverage map** to determine exactly which tests are affected by your change and runs only those. This means:

- Change a utility method → only the 3 tests that call it re-run
- Change a test → only that test re-runs
- No coverage data yet → falls back to running all tests in the project

The coverage map is built on the first full run and refined with every subsequent run.

### 📊 Sidebar — Test Explorer & Metrics

A dedicated sidebar with three panels:

- **Tests** — Full test tree grouped by Project → Class → Method, with live status icons. Click any test to jump to its source.
- **Processing Queue** — See what's running, what's queued, and what just completed.
- **Metrics** — Real-time dashboard showing pass/fail counts, coverage stats, and engine status.

### 🔍 CodeLens — Inline Test Actions

Above every test method you'll see:

- **Status** — `✓ Passed (12ms)` or `✗ Failed`
- **Run** — Click to run just this test
- **Debug** — Click to launch the debugger on this test
- **Error** — If failed, the first line of the error message

### 📟 Status Bar

A persistent status bar item shows the engine state and a quick summary: `Crunch: 42 ✓ 2 ✗`

---

## How It Works

### Architecture

```
File Watcher → Impact Analyzer → Test Runner → Results
     ↓               ↓               ↓           ↓
  .cs saves    Coverage Map    dotnet test    TRX + Coverlet
                 lookup          + filter      parsing
                                    ↓
                              Decoration Engine
                              CodeLens Provider
                              Sidebar Updates
                              Status Bar
```

### The Impact Analysis Loop

1. **Cold start**: DotNet Crunch runs your entire test suite with [Coverlet](https://github.com/coverlet-coverage/coverlet) collecting per-line coverage data
2. **Coverage map built**: For every source file and line, the engine knows which test(s) touch it
3. **You edit code**: The file watcher detects the change and diffs the old vs new content
4. **Impact analysis**: Changed lines are looked up in the coverage map → affected test IDs returned
5. **Targeted run**: Only the affected tests are executed via `dotnet test --filter`
6. **Map updated**: New coverage data is merged back into the map
7. **UI refreshed**: Gutter markers, CodeLens, sidebar, and status bar all update

### Supported Frameworks

- ✅ xUnit
- ✅ NUnit
- ✅ MSTest

DotNet Crunch auto-detects your test framework from `.csproj` references.

---

## Requirements

- **.NET SDK 6.0+** installed and available on PATH (or configured via `dotnetCrunch.dotnetPath`)
- **Coverlet** — Your test projects need the `coverlet.collector` NuGet package for coverage collection:

```bash
dotnet add package coverlet.collector
```

Most .NET test project templates include this by default. If you're not sure, check your `.csproj` for a `<PackageReference Include="coverlet.collector" />`.

---

## Getting Started

1. Install the extension
2. Open a workspace containing .NET test projects
3. The engine starts automatically (or press `Ctrl+Shift+P` → "DotNet Crunch: Start Engine")
4. Wait for the initial test run to complete
5. Start coding — you'll see gutter markers appear and tests re-run on save

---

## Extension Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `dotnetCrunch.autoStart` | `true` | Automatically start when a test project is detected |
| `dotnetCrunch.runOnSave` | `true` | Run affected tests on file save |
| `dotnetCrunch.runOnChange` | `false` | Run affected tests on every keystroke (with debounce) |
| `dotnetCrunch.debounceMs` | `500` | Debounce delay for `runOnChange` mode |
| `dotnetCrunch.maxParallelRuns` | `2` | Max concurrent `dotnet test` processes |
| `dotnetCrunch.coverageThreshold` | `80` | Coverage percentage target |
| `dotnetCrunch.excludePatterns` | `["**/obj/**", "**/bin/**", "**/Migrations/**"]` | File patterns to ignore |
| `dotnetCrunch.dotnetPath` | `"dotnet"` | Path to the `dotnet` CLI |
| `dotnetCrunch.showGutterMarkers` | `true` | Show coverage dots in the gutter |
| `dotnetCrunch.showCodeLens` | `true` | Show test status above test methods |
| `dotnetCrunch.verboseOutput` | `false` | Enable detailed logging |

---

## Commands

| Command | Description |
|---------|-------------|
| `DotNet Crunch: Start Engine` | Start watching and running tests |
| `DotNet Crunch: Stop Engine` | Stop the engine |
| `DotNet Crunch: Run All Tests` | Re-run the entire test suite |
| `DotNet Crunch: Reset Coverage Map` | Clear coverage data and re-run all tests |
| `DotNet Crunch: Toggle Gutter Markers` | Show/hide the gutter dots |
| `DotNet Crunch: Show Dashboard` | Open the output channel |

---

## Tips

- **First run is slow** — it builds and runs everything with coverage. Subsequent runs are fast because they're targeted.
- **Add `coverlet.collector`** to all test projects for coverage to work.
- **Use `runOnChange`** if you want NCrunch-level responsiveness, but be aware it's heavier on CPU.
- **Check the output channel** ("DotNet Crunch" in the Output panel) for detailed logs if something isn't working.

---

## Known Limitations

- Coverage-based impact analysis requires at least one full test run to build the initial map. Until then, all tests in the affected project are run.
- Very large solutions (1000+ tests) may benefit from increasing `maxParallelRuns`.
- The debug command requires the C# extension with `coreclr` debugger support.

---

## License

MIT — see [LICENSE](LICENSE).
