import * as vscode from 'vscode';
import { TestDiscovery } from './testDiscovery';
import { TestStatus, CrunchConfig } from './types';

/**
 * Provides CodeLens entries above test methods showing:
 * - Test status (✓ Passed, ✗ Failed, ? Unknown)
 * - Duration
 * - Run / Debug actions
 */
export class TestCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  private enabled: boolean;

  constructor(
    private testDiscovery: TestDiscovery,
    private config: CrunchConfig,
  ) {
    this.enabled = config.showCodeLens;
  }

  refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!this.enabled || document.languageId !== 'csharp') {
      return [];
    }

    const lenses: vscode.CodeLens[] = [];
    const text = document.getText();
    const lines = text.split('\n');

    // Find test methods by looking for test attributes
    const testAttributes = [
      /\[Fact\]/,
      /\[Theory\]/,
      /\[Test\]/,
      /\[TestMethod\]/,
      /\[TestCase/,
      /\[InlineData/,
    ];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const isTestAttribute = testAttributes.some(attr => attr.test(line));

      if (isTestAttribute) {
        // Find the method name on the next non-attribute, non-empty line
        let methodLine = i + 1;
        while (methodLine < lines.length) {
          const nextLine = lines[methodLine].trim();
          if (nextLine === '' || testAttributes.some(a => a.test(nextLine)) || nextLine.startsWith('[')) {
            methodLine++;
            continue;
          }

          // Extract method name from declaration
          const methodMatch = nextLine.match(/(?:public|private|protected|internal)\s+(?:async\s+)?(?:\w+(?:<[^>]+>)?)\s+(\w+)\s*\(/);
          if (methodMatch) {
            const methodName = methodMatch[1];
            const range = new vscode.Range(methodLine, 0, methodLine, 0);

            // Find the test info
            const testInfo = this.findTestByMethod(methodName, document.uri.fsPath);

            // Status lens
            const statusTitle = this.getStatusTitle(testInfo?.status, testInfo?.lastResult?.duration);
            lenses.push(new vscode.CodeLens(range, {
              title: statusTitle,
              command: '',
            }));

            // Run lens
            lenses.push(new vscode.CodeLens(range, {
              title: '$(play) Run',
              command: 'dotnetCrunch.runTest',
              arguments: [testInfo?.testId ?? methodName],
            }));

            // Debug lens
            lenses.push(new vscode.CodeLens(range, {
              title: '$(debug-alt) Debug',
              command: 'dotnetCrunch.debugTest',
              arguments: [testInfo?.testId ?? methodName],
            }));

            // Error message lens (if failed)
            if (testInfo?.lastResult?.errorMessage) {
              const errorMsg = testInfo.lastResult.errorMessage.split('\n')[0].substring(0, 100);
              lenses.push(new vscode.CodeLens(range, {
                title: `$(error) ${errorMsg}`,
                command: '',
              }));
            }
          }
          break;
        }
      }
    }

    return lenses;
  }

  private getStatusTitle(status?: TestStatus, duration?: number): string {
    const durationStr = duration ? ` (${duration}ms)` : '';
    switch (status) {
      case TestStatus.Passed: return `$(pass-filled) Passed${durationStr}`;
      case TestStatus.Failed: return `$(error) Failed${durationStr}`;
      case TestStatus.Running: return '$(sync~spin) Running...';
      case TestStatus.Queued: return '$(clock) Queued';
      case TestStatus.Skipped: return '$(circle-slash) Skipped';
      default: return '$(question) Not yet run';
    }
  }

  private findTestByMethod(methodName: string, filePath: string) {
    for (const proj of this.testDiscovery.testProjects.values()) {
      for (const test of proj.tests.values()) {
        if (test.methodName === methodName || test.fullyQualifiedName.endsWith(`.${methodName}`)) {
          return test;
        }
      }
    }
    return undefined;
  }

  updateConfig(config: CrunchConfig): void {
    this.config = config;
    this.enabled = config.showCodeLens;
    this.refresh();
  }

  dispose(): void {
    this._onDidChangeCodeLenses.dispose();
  }
}
