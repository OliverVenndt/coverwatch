# Changelog

## [1.4.0] - 2026-03-22

### Added

- **Empty filter state** — when all filters are toggled off, the tree view shows a helpful message with a "Show All Tests" button instead of appearing empty
- **Show All Tests command** — resets all filter toggles to visible in one click
- **Visible/total counts** — project descriptions now show "X/Y shown" when filters hide some tests (e.g. "3 passed, 5/8 shown")

## [1.3.0] - 2026-03-22

### Changed

- **Filter toggle icons** — filter buttons now visually change between filled (active) and outline (inactive) to show current state
- **Renamed "Other" filter to "Pending"** — clearer label indicating tests that have not yet been run
- **Simplified coverage display** — removed threshold indicator and "Tests with coverage" metric; coverage bar now uses a neutral color with just the percentage

## [1.2.0] - 2026-03-22

### Added

- **Filter toggles** — toolbar buttons to show/hide passed, failed, or pending tests in the tree view
- **Settings icon** — gear icon in the test tree title bar opens extension settings
- **Pinned tests** — pin individual tests or entire classes; pinned tests sort to top and persist across sessions
- **Coverage line totals** — metrics panel now shows "covered / total (X%)" with a progress bar

### Fixed

- **Coverage percentage** — fixed bug where coverage always showed 100% (was dividing covered lines by itself)

## [1.1.0] - 2026-03-22

### Added

- **Run mode setting** — choose between `automatic` (tests run on file change) or `manual` (tests only run when triggered) via `coverwatch.runMode`
- **Test scope setting** — choose between `impactOnly` (only affected tests) or `all` (every test in the project) via `coverwatch.testScope`
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
