import * as vscode from 'vscode';
import * as path from 'path';
import { CoverageStore } from './coverageMap';
import { TestDiscovery } from './testDiscovery';
import { TestStatus, CoverwatchConfig, LineState } from './types';
import { logVerbose } from './logger';

/**
 * Renders gutter decorations (colored dots) in the editor to show:
 * - Green dot: line is covered by passing tests
 * - Red dot: line is covered by at least one failing test
 * - Gray dot: line is executable but not covered by any test
 *
 * Also shows hover info with the test names covering each line.
 */
export class DecorationEngine implements vscode.Disposable {
  private coveredPassingDecoration: vscode.TextEditorDecorationType;
  private coveredFailingDecoration: vscode.TextEditorDecorationType;
  private uncoveredDecoration: vscode.TextEditorDecorationType;
  private disposables: vscode.Disposable[] = [];
  private enabled: boolean;

  constructor(
    private coverageStore: CoverageStore,
    private testDiscovery: TestDiscovery,
    private config: CoverwatchConfig,
  ) {
    this.enabled = config.showGutterMarkers;

    // Create decoration types with gutter icons
    this.coveredPassingDecoration = vscode.window.createTextEditorDecorationType({
      gutterIconPath: this.createGutterIcon('#22c55e'), // green
      gutterIconSize: '70%',
      overviewRulerColor: '#22c55e40',
      overviewRulerLane: vscode.OverviewRulerLane.Left,
    });

    this.coveredFailingDecoration = vscode.window.createTextEditorDecorationType({
      gutterIconPath: this.createGutterIcon('#ef4444'), // red
      gutterIconSize: '70%',
      overviewRulerColor: '#ef444440',
      overviewRulerLane: vscode.OverviewRulerLane.Left,
    });

    this.uncoveredDecoration = vscode.window.createTextEditorDecorationType({
      gutterIconPath: this.createGutterIcon('#6b7280'), // gray
      gutterIconSize: '70%',
      overviewRulerColor: '#6b728040',
      overviewRulerLane: vscode.OverviewRulerLane.Left,
    });

    // Listen for editor changes
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.refreshActiveEditor()),
      vscode.window.onDidChangeVisibleTextEditors(() => this.refreshAllEditors()),
    );
  }

  /**
   * Create an SVG gutter icon as a data URI.
   */
  private createGutterIcon(color: string): vscode.Uri {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
      <circle cx="8" cy="8" r="5" fill="${color}" opacity="0.9"/>
    </svg>`;
    return vscode.Uri.parse(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
  }

  /**
   * Refresh decorations for the active editor.
   */
  refreshActiveEditor(): void {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      this.updateDecorations(editor);
    }
  }

  /**
   * Refresh decorations for all visible editors.
   */
  refreshAllEditors(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      this.updateDecorations(editor);
    }
  }

  /**
   * Update gutter decorations for a specific editor.
   */
  private updateDecorations(editor: vscode.TextEditor): void {
    if (!this.enabled) {
      this.clearDecorations(editor);
      return;
    }

    const doc = editor.document;
    if (doc.languageId !== 'csharp') { return; }

    const filePath = doc.uri.fsPath;
    const fileCoverage = this.coverageStore.getFileCoverage(filePath);

    if (!fileCoverage) {
      logVerbose(`No coverage data for ${path.basename(filePath)}`);
      this.clearDecorations(editor);
      return;
    }

    const passingRanges: vscode.DecorationOptions[] = [];
    const failingRanges: vscode.DecorationOptions[] = [];
    const uncoveredRanges: vscode.DecorationOptions[] = [];

    for (const lineCov of fileCoverage.lines) {
      const lineIdx = lineCov.lineNumber - 1; // VS Code is 0-indexed
      if (lineIdx < 0 || lineIdx >= doc.lineCount) { continue; }

      const range = new vscode.Range(lineIdx, 0, lineIdx, 0);

      if (lineCov.hits === 0) {
        uncoveredRanges.push({
          range,
          hoverMessage: new vscode.MarkdownString('$(circle-slash) **Not covered** by any test'),
        });
        continue;
      }

      // Line is covered - check if tests pass or fail
      const testIds = this.coverageStore.getTestsForLine(filePath, lineCov.lineNumber);
      const state = this.resolveLineState(testIds);
      const hoverContent = this.buildHoverContent(testIds);

      if (state === LineState.CoveredFailing) {
        failingRanges.push({ range, hoverMessage: hoverContent });
      } else {
        passingRanges.push({ range, hoverMessage: hoverContent });
      }
    }

    editor.setDecorations(this.coveredPassingDecoration, passingRanges);
    editor.setDecorations(this.coveredFailingDecoration, failingRanges);
    editor.setDecorations(this.uncoveredDecoration, uncoveredRanges);

    logVerbose(`Decorations: ${path.basename(filePath)} — ${passingRanges.length} passing, ${failingRanges.length} failing, ${uncoveredRanges.length} uncovered`);
  }

  /**
   * Determine line state based on the tests that cover it.
   */
  private resolveLineState(testIds: string[]): LineState {
    if (testIds.length === 0) { return LineState.Uncovered; }

    let hasFailing = false;
    for (const testId of testIds) {
      const test = this.findTest(testId);
      if (test?.status === TestStatus.Failed) {
        hasFailing = true;
        break;
      }
    }

    return hasFailing ? LineState.CoveredFailing : LineState.CoveredPassing;
  }

  /**
   * Build markdown hover content showing test names and statuses.
   */
  private buildHoverContent(testIds: string[]): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;

    md.appendMarkdown(`**Coverwatch** — ${testIds.length} test(s) cover this line\n\n`);

    for (const testId of testIds.slice(0, 10)) { // Limit to 10
      const test = this.findTest(testId);
      const name = test?.displayName ?? testId.split('::').pop() ?? testId;
      const statusIcon = this.getStatusIcon(test?.status ?? TestStatus.Unknown);
      const duration = test?.lastResult?.duration
        ? ` (${test.lastResult.duration}ms)`
        : '';
      md.appendMarkdown(`${statusIcon} \`${name}\`${duration}\n\n`);
    }

    if (testIds.length > 10) {
      md.appendMarkdown(`*...and ${testIds.length - 10} more*\n`);
    }

    return md;
  }

  private getStatusIcon(status: TestStatus): string {
    switch (status) {
      case TestStatus.Passed: return '$(pass-filled)';
      case TestStatus.Failed: return '$(error)';
      case TestStatus.Running: return '$(sync~spin)';
      case TestStatus.Skipped: return '$(circle-slash)';
      default: return '$(question)';
    }
  }

  private findTest(testId: string) {
    for (const proj of this.testDiscovery.testProjects.values()) {
      const test = proj.tests.get(testId);
      if (test) { return test; }
    }
    return undefined;
  }

  /**
   * Clear all decorations from an editor.
   */
  private clearDecorations(editor: vscode.TextEditor): void {
    editor.setDecorations(this.coveredPassingDecoration, []);
    editor.setDecorations(this.coveredFailingDecoration, []);
    editor.setDecorations(this.uncoveredDecoration, []);
  }

  /**
   * Toggle gutter markers on/off.
   */
  toggle(): void {
    this.enabled = !this.enabled;
    if (this.enabled) {
      this.refreshAllEditors();
    } else {
      for (const editor of vscode.window.visibleTextEditors) {
        this.clearDecorations(editor);
      }
    }
  }

  updateConfig(config: CoverwatchConfig): void {
    this.config = config;
    this.enabled = config.showGutterMarkers;
    this.refreshAllEditors();
  }

  dispose(): void {
    this.coveredPassingDecoration.dispose();
    this.coveredFailingDecoration.dispose();
    this.uncoveredDecoration.dispose();
    for (const d of this.disposables) { d.dispose(); }
  }
}
