# Changelog

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
