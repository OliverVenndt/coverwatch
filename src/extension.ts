import * as vscode from 'vscode';
import { loadConfig, EngineState, CrunchConfig } from './types';
import { initLogger, log, logError, setVerbose } from './logger';
import { TestDiscovery } from './testDiscovery';
import { CoverageStore } from './coverageMap';
import { ImpactAnalyzer } from './impactAnalyzer';
import { TestRunner } from './testRunner';
import { FileWatcher } from './fileWatcher';
import { DecorationEngine } from './decorationEngine';
import { TestCodeLensProvider } from './codeLensProvider';
import { TestTreeProvider } from './sidebar/testTreeProvider';
import { QueueTreeProvider } from './sidebar/queueTreeProvider';
import { MetricsWebviewProvider } from './sidebar/metricsWebviewProvider';
import { StatusBar } from './statusBar';

let engine: CrunchEngine | undefined;

function extractTestId(arg: unknown): string | undefined {
  if (typeof arg === 'string') { return arg; }
  if (arg && typeof arg === 'object' && 'testInfo' in arg) {
    const testInfo = (arg as { testInfo: { testId?: string } }).testInfo;
    if (typeof testInfo?.testId === 'string') { return testInfo.testId; }
  }
  return undefined;
}

function extractClassName(arg: unknown): string | undefined {
  if (typeof arg === 'string') { return arg; }
  if (arg && typeof arg === 'object' && 'name' in arg && 'children' in arg) {
    return (arg as { name: string }).name;
  }
  return undefined;
}

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel('Coverwatch');
  const config = loadConfig();
  initLogger(outputChannel, config.verboseOutput);

  log('Coverwatch activating...');

  engine = new CrunchEngine(context, config, outputChannel);

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('coverwatch.start', () => engine?.start()),
    vscode.commands.registerCommand('coverwatch.stop', () => engine?.stop()),
    vscode.commands.registerCommand('coverwatch.runAll', () => engine?.runAll()),
    vscode.commands.registerCommand('coverwatch.resetCoverage', () => engine?.resetCoverage()),
    vscode.commands.registerCommand('coverwatch.toggleGutter', () => engine?.toggleGutter()),
    vscode.commands.registerCommand('coverwatch.runTest', (arg: unknown) => {
      const testId = extractTestId(arg);
      if (testId) { engine?.runSingleTest(testId); }
    }),
    vscode.commands.registerCommand('coverwatch.debugTest', (arg: unknown) => {
      const testId = extractTestId(arg);
      if (testId) { engine?.debugTest(testId); }
    }),
    vscode.commands.registerCommand('coverwatch.showDashboard', () => outputChannel.show()),
    vscode.commands.registerCommand('coverwatch.openSettings', () =>
      vscode.commands.executeCommand('workbench.action.openSettings', 'coverwatch')
    ),
    vscode.commands.registerCommand('coverwatch.filterPassed', () => engine?.toggleFilter('passed')),
    vscode.commands.registerCommand('coverwatch.filterPassedOff', () => engine?.toggleFilter('passed')),
    vscode.commands.registerCommand('coverwatch.filterFailed', () => engine?.toggleFilter('failed')),
    vscode.commands.registerCommand('coverwatch.filterFailedOff', () => engine?.toggleFilter('failed')),
    vscode.commands.registerCommand('coverwatch.filterPending', () => engine?.toggleFilter('pending')),
    vscode.commands.registerCommand('coverwatch.filterPendingOff', () => engine?.toggleFilter('pending')),
    vscode.commands.registerCommand('coverwatch.pinTest', (arg: unknown) => {
      const testId = extractTestId(arg);
      if (testId) { engine?.togglePinTest(testId); }
    }),
    vscode.commands.registerCommand('coverwatch.unpinTest', (arg: unknown) => {
      const testId = extractTestId(arg);
      if (testId) { engine?.togglePinTest(testId); }
    }),
    vscode.commands.registerCommand('coverwatch.pinClass', (arg: unknown) => {
      const className = extractClassName(arg);
      if (className) { engine?.togglePinClass(className); }
    }),
    vscode.commands.registerCommand('coverwatch.unpinClass', (arg: unknown) => {
      const className = extractClassName(arg);
      if (className) { engine?.togglePinClass(className); }
    }),
  );

  // Watch for config changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('coverwatch')) {
        engine?.updateConfig(loadConfig());
      }
    }),
  );

  // Auto-start if configured
  if (config.autoStart) {
    engine.start();
  }

  log('Coverwatch activated');
}

export function deactivate(): void {
  engine?.dispose();
  engine = undefined;
}

/**
 * The core engine that orchestrates all components.
 */
class CrunchEngine implements vscode.Disposable {
  private state: EngineState = EngineState.Stopped;
  private disposables: vscode.Disposable[] = [];

  // Core components
  private testDiscovery: TestDiscovery;
  private coverageStore: CoverageStore;
  private impactAnalyzer: ImpactAnalyzer;
  private testRunner: TestRunner;
  private fileWatcher: FileWatcher;

  // UI components
  private decorationEngine: DecorationEngine;
  private codeLensProvider: TestCodeLensProvider;
  private testTreeProvider: TestTreeProvider;
  private queueTreeProvider: QueueTreeProvider;
  private metricsProvider: MetricsWebviewProvider;
  private statusBar: StatusBar;

  constructor(
    private context: vscode.ExtensionContext,
    private config: CrunchConfig,
    private outputChannel: vscode.OutputChannel,
  ) {
    // Initialize core
    this.testDiscovery = new TestDiscovery(config);
    this.coverageStore = new CoverageStore();
    this.impactAnalyzer = new ImpactAnalyzer(this.coverageStore, this.testDiscovery);
    this.testRunner = new TestRunner(config, this.coverageStore, this.testDiscovery);
    this.fileWatcher = new FileWatcher(config);

    // Initialize UI
    this.decorationEngine = new DecorationEngine(this.coverageStore, this.testDiscovery, config);
    this.codeLensProvider = new TestCodeLensProvider(this.testDiscovery, config);
    this.testTreeProvider = new TestTreeProvider(this.testDiscovery);
    this.queueTreeProvider = new QueueTreeProvider();
    this.metricsProvider = new MetricsWebviewProvider(
      this.testDiscovery, this.coverageStore, config, context.extensionUri,
    );
    this.statusBar = new StatusBar(this.testDiscovery);

    // Register UI providers
    this.disposables.push(
      vscode.window.registerTreeDataProvider('coverwatch.tests', this.testTreeProvider),
      vscode.window.registerTreeDataProvider('coverwatch.queue', this.queueTreeProvider),
      vscode.window.registerWebviewViewProvider('coverwatch.metrics', this.metricsProvider),
      vscode.languages.registerCodeLensProvider({ language: 'csharp' }, this.codeLensProvider),
    );

    // Wire up events
    this.wireEvents();

    // Set initial filter context for toggle icons
    vscode.commands.executeCommand('setContext', 'coverwatch.filterPassed', true);
    vscode.commands.executeCommand('setContext', 'coverwatch.filterFailed', true);
    vscode.commands.executeCommand('setContext', 'coverwatch.filterPending', true);

    // Track all for disposal
    this.disposables.push(
      this.testRunner,
      this.fileWatcher,
      this.decorationEngine,
      this.codeLensProvider,
      this.testTreeProvider,
      this.queueTreeProvider,
      this.statusBar,
      this.outputChannel,
    );
  }

  private wireEvents(): void {
    // File changed → mark stale → optionally enqueue tests
    this.fileWatcher.onFileChanged(({ filePath, oldContent, newContent }) => {
      if (this.state !== EngineState.Running && this.state !== EngineState.Busy) { return; }

      const changedLines = this.impactAnalyzer.detectChangedLines(oldContent, newContent);
      const impact = this.impactAnalyzer.analyzeChange(filePath, changedLines);

      if (impact.affectedTestIds.length > 0) {
        // Mark affected tests as stale
        for (const testId of impact.affectedTestIds) {
          const test = this.testDiscovery.findTestById(testId);
          if (test) { test.isStale = true; }
        }
        this.testTreeProvider.refresh();
        this.codeLensProvider.refresh();

        // Only auto-run in automatic mode
        if (this.config.runMode === 'automatic') {
          let testIds: string[];
          if (this.config.testScope === 'all') {
            const projectPath = this.testDiscovery.findProjectForFile(filePath);
            const project = projectPath ? this.testDiscovery.testProjects.get(projectPath) : undefined;
            testIds = project ? Array.from(project.tests.keys()) : impact.affectedTestIds;
          } else {
            testIds = impact.affectedTestIds;
          }
          this.testRunner.enqueue(
            testIds,
            `${require('path').basename(filePath)}: ${impact.reason}`,
          );
          this.setState(EngineState.Busy);
        }
      }
    });

    // Test results → refresh UI
    this.testRunner.onTestResult(() => {
      this.testTreeProvider.refresh();
      this.codeLensProvider.refresh();
      this.decorationEngine.refreshAllEditors();
      this.metricsProvider.refresh();
      this.statusBar.update(this.state);
    });

    // Coverage updated → refresh decorations
    this.testRunner.onCoverage(() => {
      this.decorationEngine.refreshAllEditors();
      this.metricsProvider.refresh();
    });

    // Queue changed → refresh queue view
    this.testRunner.onQueueChanged((queue) => {
      this.queueTreeProvider.update(queue);

      const hasActive = queue.some(q => q.status === 'running' || q.status === 'queued');
      if (hasActive && this.state === EngineState.Running) {
        this.setState(EngineState.Busy);
      } else if (!hasActive && this.state === EngineState.Busy) {
        this.setState(EngineState.Running);
      }
    });

    // Run completed → update metrics
    this.testRunner.onRunComplete((item) => {
      const duration = item.completedAt && item.startedAt
        ? item.completedAt - item.startedAt
        : undefined;
      if (duration) {
        this.metricsProvider.setLastRunDuration(duration);
      }
    });
  }

  /**
   * Start the engine: discover projects, discover tests, start watching.
   */
  async start(): Promise<void> {
    if (this.state !== EngineState.Stopped) { return; }

    this.setState(EngineState.Starting);
    log('Engine starting...');

    try {
      // Discover test projects
      const projects = await this.testDiscovery.discoverProjects();
      if (projects.length === 0) {
        vscode.window.showWarningMessage('Coverwatch: No .NET test projects found in the workspace.');
        this.setState(EngineState.Stopped);
        return;
      }

      log(`Found ${projects.length} test project(s)`);

      // Discover tests in each project
      for (const project of projects) {
        await this.testDiscovery.discoverTests(project.projectPath);
      }

      // Restore pinned state from previous session
      this.restorePinnedTests();

      // Refresh tree
      this.testTreeProvider.refresh();
      this.metricsProvider.refresh();

      // Start file watcher
      this.fileWatcher.start();

      // Set running context for menu visibility
      vscode.commands.executeCommand('setContext', 'coverwatch.running', true);

      this.setState(EngineState.Running);
      log('Engine started');

      // Kick off initial full test run with coverage
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Coverwatch: Running initial test suite with coverage...',
          cancellable: false,
        },
        async () => {
          await this.testRunner.runAll();
        },
      );
    } catch (err) {
      logError('Engine failed to start', err);
      vscode.window.showErrorMessage(`Coverwatch failed to start: ${err}`);
      this.setState(EngineState.Stopped);
    }
  }

  /**
   * Stop the engine.
   */
  stop(): void {
    this.fileWatcher.stop();
    this.testRunner.clearQueue();
    vscode.commands.executeCommand('setContext', 'coverwatch.running', false);
    this.setState(EngineState.Stopped);
    log('Engine stopped');
  }

  /**
   * Run all tests.
   */
  async runAll(): Promise<void> {
    await this.testRunner.runAll();
  }

  /**
   * Reset the coverage map and re-run all tests.
   */
  async resetCoverage(): Promise<void> {
    this.coverageStore.reset();
    this.decorationEngine.refreshAllEditors();
    this.metricsProvider.refresh();
    log('Coverage reset — running full test suite...');

    if (this.state === EngineState.Running || this.state === EngineState.Busy) {
      await this.testRunner.runAll();
    }
  }

  /**
   * Toggle gutter markers.
   */
  toggleGutter(): void {
    this.decorationEngine.toggle();
  }

  /**
   * Run a single test by ID.
   */
  runSingleTest(testId: string): void {
    this.testRunner.enqueue([testId], 'Manual run');
  }

  /**
   * Debug a single test (opens VS Code debugger).
   */
  async debugTest(testId: string): Promise<void> {
    // Extract FQN
    const fqn = testId.includes('::') ? testId.split('::').pop()! : testId;
    const projectPath = testId.includes('::') ? testId.split('::')[0] : undefined;

    if (!projectPath) {
      vscode.window.showWarningMessage('Cannot determine project for test');
      return;
    }

    // Launch debug configuration
    const debugConfig: vscode.DebugConfiguration = {
      name: `Debug: ${fqn.split('.').pop()}`,
      type: 'coreclr',
      request: 'launch',
      program: this.config.dotnetPath,
      args: ['test', projectPath, '--filter', `FullyQualifiedName=${fqn}`, '--no-build'],
      cwd: require('path').dirname(projectPath),
      console: 'internalConsole',
      stopAtEntry: false,
    };

    await vscode.debug.startDebugging(undefined, debugConfig);
  }

  /**
   * Toggle a tree view filter.
   */
  toggleFilter(filter: 'passed' | 'failed' | 'pending'): void {
    this.testTreeProvider.setFilter(filter);
    const state = this.testTreeProvider.getFilterState();
    vscode.commands.executeCommand('setContext', 'coverwatch.filterPassed', state.showPassed);
    vscode.commands.executeCommand('setContext', 'coverwatch.filterFailed', state.showFailed);
    vscode.commands.executeCommand('setContext', 'coverwatch.filterPending', state.showPending);
  }

  /**
   * Toggle pin on a single test.
   */
  togglePinTest(testId: string): void {
    const test = this.testDiscovery.findTestById(testId);
    if (!test) { return; }
    test.isPinned = !test.isPinned;
    this.savePinnedTests();
    this.testTreeProvider.refresh();
  }

  /**
   * Toggle pin on all tests in a class.
   */
  togglePinClass(className: string): void {
    const allTests = this.testDiscovery.getAllTests().filter(t => t.className === className);
    const allPinned = allTests.every(t => t.isPinned);
    for (const test of allTests) { test.isPinned = !allPinned; }
    this.savePinnedTests();
    this.testTreeProvider.refresh();
  }

  private savePinnedTests(): void {
    const pinnedIds = this.testDiscovery.getAllTests()
      .filter(t => t.isPinned).map(t => t.testId);
    this.context.globalState.update('coverwatch.pinnedTests', pinnedIds);
  }

  private restorePinnedTests(): void {
    const pinnedIds = this.context.globalState.get<string[]>('coverwatch.pinnedTests', []);
    const pinnedSet = new Set(pinnedIds);
    for (const test of this.testDiscovery.getAllTests()) {
      if (pinnedSet.has(test.testId)) { test.isPinned = true; }
    }
  }

  /**
   * Update configuration.
   */
  updateConfig(config: CrunchConfig): void {
    this.config = config;
    setVerbose(config.verboseOutput);
    this.testDiscovery.updateConfig(config);
    this.testRunner.updateConfig(config);
    this.fileWatcher.updateConfig(config);
    this.decorationEngine.updateConfig(config);
    this.codeLensProvider.updateConfig(config);
    this.metricsProvider.updateConfig(config);
    log('Configuration updated');
  }

  private setState(state: EngineState): void {
    this.state = state;
    this.statusBar.update(state);
    this.metricsProvider.setEngineState(state);
  }

  dispose(): void {
    this.stop();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
