import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { XMLParser } from 'fast-xml-parser';
import {
  TestResult, TestStatus, QueueItem, CoverwatchConfig, FileCoverage,
} from './types';
import { CoverageStore } from './coverageMap';
import { TestDiscovery } from './testDiscovery';
import { log, logVerbose, logError } from './logger';

/**
 * Orchestrates test execution with coverage collection.
 * Manages a queue of test runs, executes them with concurrency limits,
 * and parses both TRX results and Coverlet coverage output.
 */
export class TestRunner {
  private queue: QueueItem[] = [];
  private activeRuns = 0;
  private runCounter = 0;

  private readonly _onTestResult = new vscode.EventEmitter<TestResult>();
  readonly onTestResult = this._onTestResult.event;

  private readonly _onCoverage = new vscode.EventEmitter<FileCoverage[]>();
  readonly onCoverage = this._onCoverage.event;

  private readonly _onQueueChanged = new vscode.EventEmitter<QueueItem[]>();
  readonly onQueueChanged = this._onQueueChanged.event;

  private readonly _onRunComplete = new vscode.EventEmitter<QueueItem>();
  readonly onRunComplete = this._onRunComplete.event;

  constructor(
    private config: CoverwatchConfig,
    private coverageStore: CoverageStore,
    private testDiscovery: TestDiscovery,
  ) {}

  /**
   * Enqueue a test run for a set of test IDs.
   */
  enqueue(testIds: string[], reason: string): QueueItem {
    // Group tests by project
    const byProject = new Map<string, string[]>();
    for (const testId of testIds) {
      const projPath = testId.split('::')[0];
      if (!byProject.has(projPath)) {
        byProject.set(projPath, []);
      }
      byProject.get(projPath)!.push(testId);
    }

    // Create queue items per project
    let lastItem: QueueItem | undefined;
    for (const [projectPath, projectTestIds] of byProject) {
      const item: QueueItem = {
        id: `run-${++this.runCounter}`,
        testIds: projectTestIds,
        projectPath,
        reason,
        status: 'queued',
        createdAt: Date.now(),
      };

      // Deduplicate: if there's already a queued item for the same project, merge
      const existing = this.queue.find(q => q.status === 'queued' && q.projectPath === projectPath);
      if (existing) {
        const merged = new Set([...existing.testIds, ...projectTestIds]);
        existing.testIds = Array.from(merged);
        existing.reason = reason;
        lastItem = existing;
        logVerbose(`Merged into existing queue item ${existing.id}`);
      } else {
        this.queue.push(item);
        lastItem = item;
        logVerbose(`Queued ${item.id}: ${projectTestIds.length} tests in ${path.basename(projectPath, '.csproj')}`);
      }
    }

    this._onQueueChanged.fire(this.queue);
    this.processQueue();

    return lastItem!;
  }

  /**
   * Run all tests in all projects (full baseline run).
   */
  async runAll(): Promise<void> {
    const allTests = this.testDiscovery.getAllTests();
    if (allTests.length === 0) {
      log('No tests to run');
      return;
    }
    this.enqueue(allTests.map(t => t.testId), 'Full test run');
  }

  /**
   * Process the next item in the queue.
   */
  private async processQueue(): Promise<void> {
    if (this.activeRuns >= this.config.maxParallelRuns) { return; }

    const next = this.queue.find(q => q.status === 'queued');
    if (!next) { return; }

    next.status = 'running';
    next.startedAt = Date.now();
    this.activeRuns++;
    this._onQueueChanged.fire(this.queue);

    try {
      await this.executeRun(next);
      next.status = 'completed';
    } catch (err) {
      logError(`Run ${next.id} failed`, err);
      next.status = 'failed';
    } finally {
      next.completedAt = Date.now();
      this.activeRuns--;
      this._onRunComplete.fire(next);
      this._onQueueChanged.fire(this.queue);

      // Clean up old completed items
      this.queue = this.queue.filter(q =>
        q.status === 'queued' || q.status === 'running' ||
        (q.completedAt && Date.now() - q.completedAt < 30000)
      );

      // Process next
      this.processQueue();
    }
  }

  /**
   * Execute a single test run with coverage.
   */
  private async executeRun(item: QueueItem): Promise<void> {
    const project = this.testDiscovery.testProjects.get(item.projectPath);
    if (!project) {
      logError(`Project not found: ${item.projectPath}`);
      return;
    }

    // Create temp directory for results
    const tmpDir = path.join(os.tmpdir(), 'coverwatch', item.id);
    fs.mkdirSync(tmpDir, { recursive: true });

    const trxPath = path.join(tmpDir, 'results.trx');
    const coverageDir = path.join(tmpDir, 'coverage');

    // Build filter expression
    const isFullRun = item.testIds.length === (project.tests.size || item.testIds.length);
    let filterExpr = '';

    if (!isFullRun && item.testIds.length > 0) {
      // Extract FQN from testId format "projectPath::FQN"
      const fqns = item.testIds.map(id => {
        const parts = id.split('::');
        return parts[parts.length - 1];
      });

      // dotnet test --filter supports FullyQualifiedName~Value
      if (fqns.length <= 50) {
        filterExpr = fqns.map(fqn => `FullyQualifiedName=${fqn}`).join('|');
      }
      // If too many tests, just run all (faster than a huge filter)
    }

    // Clear previous coverage for these tests
    this.coverageStore.clearTestCoverage(item.testIds);

    // Build args
    const args: string[] = [
      'test',
      item.projectPath,
      '--logger', `trx;LogFileName=${trxPath}`,
      '--collect:XPlat Code Coverage',
      '--results-directory', coverageDir,
      '-v', 'q',
      '--no-build',
    ];

    if (filterExpr) {
      args.push('--filter', filterExpr);
    }

    log(`Running ${item.testIds.length} tests in ${project.name}...`);
    logVerbose(`Command: ${this.config.dotnetPath} ${args.join(' ')}`);

    return new Promise<void>((resolve, reject) => {
      const proc = cp.spawn(this.config.dotnetPath, args, {
        cwd: path.dirname(item.projectPath),
        env: {
          ...process.env,
          DOTNET_CLI_TELEMETRY_OPTOUT: '1',
        },
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.stderr.on('data', (d) => { stderr += d.toString(); });

      proc.on('close', async (code) => {
        logVerbose(`dotnet test exited with code ${code}`);

        // Parse TRX results
        if (fs.existsSync(trxPath)) {
          this.parseTrxResults(trxPath, item);
        } else {
          // TRX might be in a subdirectory
          const trxFiles = this.findFiles(tmpDir, '.trx');
          if (trxFiles.length > 0) {
            this.parseTrxResults(trxFiles[0], item);
          } else {
            logVerbose('No TRX file found, parsing stdout for results');
            this.parseStdoutResults(stdout, item);
          }
        }

        // Parse coverage
        const coberturaFiles = this.findFiles(coverageDir, 'coverage.cobertura.xml');
        if (coberturaFiles.length > 0) {
          const fileCoverage = this.coverageStore.parseCoberturaXml(coberturaFiles[0]);
          this.coverageStore.ingestCoverageForTests(item.testIds, fileCoverage);
          this._onCoverage.fire(fileCoverage);
        } else {
          logVerbose('No Cobertura coverage file found');
        }

        // Cleanup temp
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch { /* ignore */ }

        const duration = Date.now() - (item.startedAt ?? Date.now());
        log(`Completed ${item.testIds.length} tests in ${project.name} (${duration}ms)`);

        resolve();
      });

      proc.on('error', (err) => {
        logError('dotnet test process error', err);
        // Try fallback without --no-build
        if (args.includes('--no-build')) {
          logVerbose('Retrying without --no-build...');
          const retryArgs = args.filter(a => a !== '--no-build');
          this.executeWithArgs(retryArgs, item, tmpDir, coverageDir).then(resolve).catch(reject);
        } else {
          reject(err);
        }
      });
    });
  }

  private async executeWithArgs(args: string[], item: QueueItem, tmpDir: string, coverageDir: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const proc = cp.spawn(this.config.dotnetPath, args, {
        cwd: path.dirname(item.projectPath),
      });

      let stdout = '';
      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.on('close', () => {
        const trxFiles = this.findFiles(tmpDir, '.trx');
        if (trxFiles.length > 0) {
          this.parseTrxResults(trxFiles[0], item);
        }

        const coberturaFiles = this.findFiles(coverageDir, 'coverage.cobertura.xml');
        if (coberturaFiles.length > 0) {
          const fileCoverage = this.coverageStore.parseCoberturaXml(coberturaFiles[0]);
          this.coverageStore.ingestCoverageForTests(item.testIds, fileCoverage);
          this._onCoverage.fire(fileCoverage);
        }

        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
        resolve();
      });
      proc.on('error', reject);
    });
  }

  /**
   * Parse TRX (Visual Studio Test Results) XML file.
   */
  private parseTrxResults(trxPath: string, item: QueueItem): void {
    try {
      const xml = fs.readFileSync(trxPath, 'utf-8');
      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        isArray: (name) => ['UnitTestResult', 'UnitTest', 'TestEntry'].includes(name),
      });
      const parsed = parser.parse(xml);
      const testRun = parsed.TestRun;
      if (!testRun) { return; }

      const results = this.ensureArray(testRun.Results?.UnitTestResult ?? []);

      for (const result of results) {
        const testName = result['@_testName'] ?? '';
        const outcome = (result['@_outcome'] ?? '').toLowerCase();
        const duration = this.parseDuration(result['@_duration'] ?? '');

        let status: TestStatus;
        switch (outcome) {
          case 'passed': status = TestStatus.Passed; break;
          case 'failed': status = TestStatus.Failed; break;
          case 'notexecuted':
          case 'skipped': status = TestStatus.Skipped; break;
          default: status = TestStatus.Unknown;
        }

        // Extract error info
        const output = result.Output;
        const errorMessage = output?.ErrorInfo?.Message ?? '';
        const errorStackTrace = output?.ErrorInfo?.StackTrace ?? '';

        // Find matching test ID
        const testId = item.testIds.find(id => id.endsWith(`::${testName}`))
          ?? `${item.projectPath}::${testName}`;

        const testResult: TestResult = {
          testId,
          fullyQualifiedName: testName,
          displayName: testName.split('.').pop() ?? testName,
          status,
          duration,
          errorMessage: typeof errorMessage === 'string' ? errorMessage : '',
          errorStackTrace: typeof errorStackTrace === 'string' ? errorStackTrace : '',
        };

        // Update the test in discovery
        for (const proj of this.testDiscovery.testProjects.values()) {
          for (const [id, test] of proj.tests) {
            if (id === testId || test.fullyQualifiedName === testName) {
              test.status = status;
              test.lastResult = testResult;
              test.lastRunTime = Date.now();
              test.isStale = false;
              break;
            }
          }
        }

        this._onTestResult.fire(testResult);
      }

      logVerbose(`Parsed ${results.length} test results from TRX`);
    } catch (err) {
      logError('Failed to parse TRX file', err);
    }
  }

  /**
   * Fallback: parse dotnet test stdout for basic pass/fail info.
   */
  private parseStdoutResults(stdout: string, item: QueueItem): void {
    const lines = stdout.split('\n');
    for (const raw of lines) {
      const line = raw.trim();
      const passMatch = line.match(/Passed\s+(\S+)/);
      const failMatch = line.match(/Failed\s+(\S+)/);

      if (passMatch || failMatch) {
        const testName = (passMatch ?? failMatch)![1];
        const status = passMatch ? TestStatus.Passed : TestStatus.Failed;
        const testId = item.testIds.find(id => id.includes(testName))
          ?? `${item.projectPath}::${testName}`;

        // Clear stale flag on the discovered test
        for (const proj of this.testDiscovery.testProjects.values()) {
          for (const [id, test] of proj.tests) {
            if (id === testId || test.fullyQualifiedName === testName) {
              test.status = status;
              test.lastRunTime = Date.now();
              test.isStale = false;
              break;
            }
          }
        }

        this._onTestResult.fire({
          testId,
          fullyQualifiedName: testName,
          displayName: testName.split('.').pop() ?? testName,
          status,
        });
      }
    }
  }

  /**
   * Parse TRX duration string (HH:MM:SS.mmm) to milliseconds.
   */
  private parseDuration(dur: string): number {
    const match = dur.match(/(\d+):(\d+):(\d+)\.?(\d*)/);
    if (!match) { return 0; }
    const [, h, m, s, ms] = match;
    return (
      parseInt(h) * 3600000 +
      parseInt(m) * 60000 +
      parseInt(s) * 1000 +
      parseInt((ms ?? '0').padEnd(3, '0').substring(0, 3))
    );
  }

  /**
   * Recursively find files matching a pattern.
   */
  private findFiles(dir: string, pattern: string): string[] {
    const results: string[] = [];
    if (!fs.existsSync(dir)) { return results; }

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...this.findFiles(fullPath, pattern));
      } else if (entry.name.includes(pattern) || entry.name.endsWith(pattern)) {
        results.push(fullPath);
      }
    }
    return results;
  }

  private ensureArray<T>(value: T | T[]): T[] {
    return Array.isArray(value) ? value : value ? [value] : [];
  }

  getQueue(): QueueItem[] {
    return [...this.queue];
  }

  clearQueue(): void {
    this.queue = this.queue.filter(q => q.status === 'running');
    this._onQueueChanged.fire(this.queue);
  }

  updateConfig(config: CoverwatchConfig): void {
    this.config = config;
  }

  dispose(): void {
    this._onTestResult.dispose();
    this._onCoverage.dispose();
    this._onQueueChanged.dispose();
    this._onRunComplete.dispose();
  }
}
