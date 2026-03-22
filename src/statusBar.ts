import * as vscode from 'vscode';
import { EngineState, TestStatus } from './types';
import { TestDiscovery } from './testDiscovery';

/**
 * Manages a status bar item that shows:
 * - Engine state (running/stopped)
 * - Quick test summary (e.g., "42 ✓ 2 ✗")
 */
export class StatusBar implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;

  constructor(private testDiscovery: TestDiscovery) {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100,
    );
    this.statusBarItem.command = 'coverwatch.showDashboard';
    this.statusBarItem.name = 'Coverwatch';
    this.statusBarItem.show();
    this.update(EngineState.Stopped);
  }

  update(state: EngineState): void {
    const tests = this.testDiscovery.getAllTests();
    const passed = tests.filter(t => t.status === TestStatus.Passed).length;
    const failed = tests.filter(t => t.status === TestStatus.Failed).length;
    const total = tests.length;

    let icon: string;
    let stateText: string;

    switch (state) {
      case EngineState.Running:
        icon = '$(beaker)';
        stateText = '';
        break;
      case EngineState.Busy:
        icon = '$(sync~spin)';
        stateText = '';
        break;
      case EngineState.Starting:
        icon = '$(loading~spin)';
        stateText = 'Starting...';
        break;
      default:
        icon = '$(circle-slash)';
        stateText = 'Stopped';
    }

    let text = `${icon} Crunch`;

    if (total > 0 && state !== EngineState.Stopped) {
      const parts: string[] = [];
      if (passed > 0) { parts.push(`${passed} $(pass-filled)`); }
      if (failed > 0) { parts.push(`${failed} $(error)`); }
      if (total - passed - failed > 0) { parts.push(`${total - passed - failed} $(question)`); }
      text += `: ${parts.join(' ')}`;
    } else if (stateText) {
      text += ` ${stateText}`;
    }

    this.statusBarItem.text = text;

    if (failed > 0) {
      this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else if (state === EngineState.Running && passed === total && total > 0) {
      this.statusBarItem.backgroundColor = undefined;
    } else {
      this.statusBarItem.backgroundColor = undefined;
    }

    this.statusBarItem.tooltip = new vscode.MarkdownString(
      `**Coverwatch**\n\n` +
      `Engine: ${state}\n\n` +
      `Tests: ${passed} passed, ${failed} failed, ${total} total`
    );
  }

  dispose(): void {
    this.statusBarItem.dispose();
  }
}
