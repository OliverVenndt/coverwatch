import * as vscode from 'vscode';
import { TestDiscovery } from '../testDiscovery';
import { CoverageStore } from '../coverageMap';
import { TestStatus, CrunchConfig, EngineState } from '../types';

/**
 * Provides a webview panel in the sidebar with real-time metrics:
 * - Engine status
 * - Test counts (passed/failed/skipped/total)
 * - Coverage percentage
 * - Last run time
 */
export class MetricsWebviewProvider implements vscode.WebviewViewProvider {
  private webviewView?: vscode.WebviewView;
  private engineState: EngineState = EngineState.Stopped;
  private lastRunDuration?: number;

  constructor(
    private testDiscovery: TestDiscovery,
    private coverageStore: CoverageStore,
    private config: CrunchConfig,
    private extensionUri: vscode.Uri,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.webviewView = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
    };
    this.refresh();
  }

  setEngineState(state: EngineState): void {
    this.engineState = state;
    this.refresh();
  }

  setLastRunDuration(ms: number): void {
    this.lastRunDuration = ms;
    this.refresh();
  }

  refresh(): void {
    if (!this.webviewView) { return; }

    const tests = this.testDiscovery.getAllTests();
    const passed = tests.filter(t => t.status === TestStatus.Passed).length;
    const failed = tests.filter(t => t.status === TestStatus.Failed).length;
    const skipped = tests.filter(t => t.status === TestStatus.Skipped).length;
    const total = tests.length;
    const notRun = total - passed - failed - skipped;

    const metrics = this.coverageStore.getMetrics();
    const coveragePct = metrics.totalInstrumentedLines > 0
      ? Math.round((metrics.totalCoveredLines / metrics.totalInstrumentedLines) * 100)
      : 0;

    const engineColor = this.engineState === EngineState.Running ? '#22c55e'
      : this.engineState === EngineState.Busy ? '#eab308'
      : '#6b7280';

    const engineLabel = this.engineState === EngineState.Running ? 'Running'
      : this.engineState === EngineState.Busy ? 'Processing'
      : this.engineState === EngineState.Starting ? 'Starting...'
      : 'Stopped';

    this.webviewView.webview.html = /* html */`
<!DOCTYPE html>
<html>
<head>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      padding: 12px;
    }
    .section {
      margin-bottom: 16px;
    }
    .section-title {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 8px;
      font-weight: 600;
    }
    .engine-status {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
    }
    .status-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .stat {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.1));
      border-radius: 6px;
      padding: 10px;
    }
    .stat-value {
      font-size: 20px;
      font-weight: 700;
      line-height: 1;
    }
    .stat-label {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-top: 4px;
    }
    .stat-value.green { color: #22c55e; }
    .stat-value.red { color: #ef4444; }
    .stat-value.yellow { color: #eab308; }
    .stat-value.blue { color: #3b82f6; }
    .stat-value.gray { color: var(--vscode-descriptionForeground); }
    .bar {
      height: 6px;
      border-radius: 3px;
      background: var(--vscode-progressBar-background, rgba(255,255,255,0.1));
      overflow: hidden;
      margin-top: 8px;
    }
    .bar-fill {
      height: 100%;
      border-radius: 3px;
      transition: width 0.3s ease;
    }
    .bar-segments {
      display: flex;
      height: 100%;
    }
    .bar-segment {
      height: 100%;
      transition: width 0.3s ease;
    }
    .coverage-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 8px;
    }
    .threshold-label {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
    }
    .info-row {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      padding: 3px 0;
    }
    .info-value {
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="section">
    <div class="engine-status">
      <div class="status-dot" style="background: ${engineColor};"></div>
      <span>${engineLabel}</span>
      ${this.lastRunDuration ? `<span style="color: var(--vscode-descriptionForeground); margin-left: auto; font-size: 11px;">Last: ${this.lastRunDuration}ms</span>` : ''}
    </div>
  </div>

  <div class="section">
    <div class="section-title">Test Results</div>
    <div class="stats-grid">
      <div class="stat">
        <div class="stat-value green">${passed}</div>
        <div class="stat-label">Passed</div>
      </div>
      <div class="stat">
        <div class="stat-value red">${failed}</div>
        <div class="stat-label">Failed</div>
      </div>
      <div class="stat">
        <div class="stat-value gray">${skipped}</div>
        <div class="stat-label">Skipped</div>
      </div>
      <div class="stat">
        <div class="stat-value blue">${total}</div>
        <div class="stat-label">Total</div>
      </div>
    </div>
    <div class="bar" style="margin-top: 12px;">
      <div class="bar-segments">
        <div class="bar-segment" style="width: ${total > 0 ? (passed / total * 100) : 0}%; background: #22c55e;"></div>
        <div class="bar-segment" style="width: ${total > 0 ? (failed / total * 100) : 0}%; background: #ef4444;"></div>
        <div class="bar-segment" style="width: ${total > 0 ? (skipped / total * 100) : 0}%; background: #6b7280;"></div>
        <div class="bar-segment" style="width: ${total > 0 ? (notRun / total * 100) : 0}%; background: var(--vscode-widget-border, rgba(255,255,255,0.1));"></div>
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Coverage</div>
    <div class="info-row">
      <span>Files instrumented</span>
      <span class="info-value">${metrics.totalFiles}</span>
    </div>
    <div class="info-row">
      <span>Lines covered</span>
      <span class="info-value">${metrics.totalCoveredLines.toLocaleString()} / ${metrics.totalInstrumentedLines.toLocaleString()} (${coveragePct}%)</span>
    </div>
    <div class="bar">
      <div class="bar-fill" style="width: ${coveragePct}%; background: var(--vscode-progressBar-background, #0078d4);"></div>
    </div>
  </div>
</body>
</html>`;
  }

  updateConfig(config: CrunchConfig): void {
    this.config = config;
  }

  dispose(): void {
    // nothing to dispose
  }
}
