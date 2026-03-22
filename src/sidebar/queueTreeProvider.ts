import * as vscode from 'vscode';
import * as path from 'path';
import { QueueItem } from '../types';

/**
 * Shows the test run processing queue in the sidebar.
 */
export class QueueTreeProvider implements vscode.TreeDataProvider<QueueItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<QueueItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private items: QueueItem[] = [];

  update(items: QueueItem[]): void {
    this.items = items;
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: QueueItem): vscode.TreeItem {
    const item = new vscode.TreeItem(element.reason, vscode.TreeItemCollapsibleState.None);

    switch (element.status) {
      case 'running':
        item.iconPath = new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.yellow'));
        item.description = `${element.testIds.length} tests`;
        break;
      case 'queued':
        item.iconPath = new vscode.ThemeIcon('clock', new vscode.ThemeColor('charts.blue'));
        item.description = `${element.testIds.length} tests`;
        break;
      case 'completed':
        item.iconPath = new vscode.ThemeIcon('pass', new vscode.ThemeColor('charts.green'));
        const duration = element.completedAt && element.startedAt
          ? `${element.completedAt - element.startedAt}ms`
          : '';
        item.description = duration;
        break;
      case 'failed':
        item.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
        item.description = 'error';
        break;
    }

    item.tooltip = `${element.id}\n${element.testIds.length} tests in ${path.basename(element.projectPath, '.csproj')}`;
    return item;
  }

  getChildren(): QueueItem[] {
    return this.items;
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
