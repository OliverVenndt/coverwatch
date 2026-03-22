import * as vscode from 'vscode';
import * as path from 'path';
import { TestDiscovery } from '../testDiscovery';
import { TestInfo, TestStatus } from '../types';

type TreeNode = ProjectNode | ClassNode | TestNode;

class ProjectNode {
  constructor(
    public readonly name: string,
    public readonly projectPath: string,
    public readonly children: ClassNode[],
  ) {}
}

class ClassNode {
  constructor(
    public readonly name: string,
    public readonly children: TestNode[],
  ) {}
}

class TestNode {
  constructor(
    public readonly testInfo: TestInfo,
  ) {}
}

/**
 * Provides the test tree view in the sidebar.
 * Tests are grouped by: Project → Class → Test Method
 */
export class TestTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private testDiscovery: TestDiscovery) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    if (element instanceof ProjectNode) {
      const item = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.Expanded);
      item.iconPath = new vscode.ThemeIcon('project');
      item.contextValue = 'project';
      item.description = this.getProjectDescription(element);
      return item;
    }

    if (element instanceof ClassNode) {
      const item = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.Expanded);
      item.iconPath = new vscode.ThemeIcon('symbol-class');
      item.contextValue = 'testClass';
      item.description = this.getClassDescription(element);
      return item;
    }

    // TestNode
    const test = element.testInfo;
    const item = new vscode.TreeItem(test.displayName, vscode.TreeItemCollapsibleState.None);
    item.iconPath = this.getTestIcon(test);
    item.contextValue = `test-${test.status}`;
    item.tooltip = this.getTestTooltip(test);

    const descParts: string[] = [];
    if (test.isStale) { descParts.push('stale'); }
    if (test.lastResult?.duration) { descParts.push(`${test.lastResult.duration}ms`); }
    if (descParts.length > 0) { item.description = descParts.join(' \u00B7 '); }

    // Click to navigate to test source
    if (test.sourceFile && test.sourceLine) {
      item.command = {
        title: 'Go to test',
        command: 'vscode.open',
        arguments: [
          vscode.Uri.file(test.sourceFile),
          { selection: new vscode.Range(test.sourceLine - 1, 0, test.sourceLine - 1, 0) },
        ],
      };
    }

    return item;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) {
      return this.buildTree();
    }
    if (element instanceof ProjectNode) {
      return element.children;
    }
    if (element instanceof ClassNode) {
      return element.children;
    }
    return [];
  }

  private buildTree(): ProjectNode[] {
    const projects: ProjectNode[] = [];

    for (const [projectPath, project] of this.testDiscovery.testProjects) {
      // Group tests by class
      const classBuckets = new Map<string, TestInfo[]>();
      for (const test of project.tests.values()) {
        const className = test.className || 'Unknown';
        if (!classBuckets.has(className)) {
          classBuckets.set(className, []);
        }
        classBuckets.get(className)!.push(test);
      }

      const classNodes: ClassNode[] = [];
      for (const [className, tests] of classBuckets) {
        const testNodes = tests
          .sort((a, b) => a.displayName.localeCompare(b.displayName))
          .map(t => new TestNode(t));
        classNodes.push(new ClassNode(className, testNodes));
      }

      classNodes.sort((a, b) => a.name.localeCompare(b.name));
      projects.push(new ProjectNode(project.name, projectPath, classNodes));
    }

    return projects.sort((a, b) => a.name.localeCompare(b.name));
  }

  private getTestIcon(test: TestInfo): vscode.ThemeIcon {
    if (test.isStale) {
      switch (test.status) {
        case TestStatus.Passed: return new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconQueued'));
        case TestStatus.Failed: return new vscode.ThemeIcon('warning', new vscode.ThemeColor('testing.iconQueued'));
        default: return new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('testing.iconUnset'));
      }
    }
    switch (test.status) {
      case TestStatus.Passed: return new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed'));
      case TestStatus.Failed: return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
      case TestStatus.Running: return new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('testing.iconQueued'));
      case TestStatus.Queued: return new vscode.ThemeIcon('clock', new vscode.ThemeColor('testing.iconQueued'));
      case TestStatus.Skipped: return new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('testing.iconSkipped'));
      default: return new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('testing.iconUnset'));
    }
  }

  private getProjectDescription(node: ProjectNode): string {
    let passed = 0, failed = 0, total = 0;
    for (const cls of node.children) {
      for (const test of cls.children) {
        total++;
        if (test.testInfo.status === TestStatus.Passed) { passed++; }
        if (test.testInfo.status === TestStatus.Failed) { failed++; }
      }
    }
    if (total === 0) { return 'no tests'; }
    const parts: string[] = [];
    if (passed > 0) { parts.push(`${passed} passed`); }
    if (failed > 0) { parts.push(`${failed} failed`); }
    parts.push(`${total} total`);
    return parts.join(', ');
  }

  private getClassDescription(node: ClassNode): string {
    const passed = node.children.filter(t => t.testInfo.status === TestStatus.Passed).length;
    const failed = node.children.filter(t => t.testInfo.status === TestStatus.Failed).length;
    const total = node.children.length;
    if (failed > 0) { return `${failed}/${total} failed`; }
    if (passed === total) { return `${total}/${total} passed`; }
    return `${passed}/${total}`;
  }

  private getTestTooltip(test: TestInfo): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${test.fullyQualifiedName}**\n\n`);
    md.appendMarkdown(`Status: ${test.status}\n\n`);
    if (test.lastResult?.duration) {
      md.appendMarkdown(`Duration: ${test.lastResult.duration}ms\n\n`);
    }
    if (test.lastResult?.errorMessage) {
      md.appendMarkdown(`---\n\n`);
      md.appendCodeblock(test.lastResult.errorMessage, 'text');
    }
    if (test.lastResult?.errorStackTrace) {
      md.appendCodeblock(test.lastResult.errorStackTrace.substring(0, 500), 'text');
    }
    return md;
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
