# Changelog

## [1.1.0] - 2026-03-22

### Added

- **Run mode setting** — choose between `automatic` (tests run on file change) or `manual` (tests only run when triggered) via `dotnetCrunch.runMode`
- **Test scope setting** — choose between `impactOnly` (only affected tests) or `all` (every test in the project) via `dotnetCrunch.testScope`
- **Stale test indicators** — tests whose source changed but haven't re-run show faded icons (outline pass / warning triangle) with a "stale" label
- **Click-to-navigate** — clicking a test in the sidebar opens the source file at the test method
- **Source location resolution** — test discovery now scans `.cs` files to populate source file and line info

### Fixed

- **Tree view Run/Debug buttons** — fixed `t.split is not a function` error when clicking inline Run or Debug buttons in the test panel

## [1.0.0] - 2026-03-22

### Added

- **Continuous testing engine** — automatic test execution on file save or keystroke
- **Impact analysis** — coverage-based detection of affected tests, only re-runs what matters
- **Gutter markers** — green/red/gray dots showing per-line coverage and test status
- **CodeLens** — inline test status, run, and debug actions above test methods
- **Sidebar test tree** — tests grouped by Project → Class → Method with live status icons
- **Processing queue panel** — real-time view of queued, running, and completed test runs
- **Metrics dashboard** — webview panel with pass/fail counts, coverage stats, engine status
- **Status bar** — persistent summary of engine state and test results
- **Test framework support** — xUnit, NUnit, MSTest auto-detection
- **Coverage collection** — Coverlet integration with Cobertura XML parsing
- **TRX result parsing** — full test result extraction including error messages and stack traces
- **Debug integration** — launch `coreclr` debugger on individual tests
- **Configurable** — debounce timing, parallel runs, exclude patterns, gutter toggle, and more
