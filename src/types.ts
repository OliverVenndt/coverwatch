import * as vscode from 'vscode';

// ── Test Status ──────────────────────────────────────────────────────
export enum TestStatus {
  Unknown = 'unknown',
  Queued = 'queued',
  Running = 'running',
  Passed = 'passed',
  Failed = 'failed',
  Skipped = 'skipped',
}

// ── Test Result ──────────────────────────────────────────────────────
export interface TestResult {
  testId: string;
  fullyQualifiedName: string;
  displayName: string;
  status: TestStatus;
  duration?: number;        // ms
  errorMessage?: string;
  errorStackTrace?: string;
  output?: string;
}

// ── Test Info (discovered) ───────────────────────────────────────────
export interface TestInfo {
  testId: string;
  fullyQualifiedName: string;
  displayName: string;
  className: string;
  methodName: string;
  projectPath: string;
  sourceFile?: string;
  sourceLine?: number;
  status: TestStatus;
  lastResult?: TestResult;
  lastRunTime?: number;
  isStale?: boolean;
  isPinned?: boolean;
}

// ── Coverage ─────────────────────────────────────────────────────────
export interface LineCoverage {
  lineNumber: number;
  hits: number;
  branchCoverage?: number;    // 0.0-1.0
}

export interface FileCoverage {
  filePath: string;
  lines: LineCoverage[];
  lineRate: number;           // 0.0-1.0
  branchRate: number;         // 0.0-1.0
}

/** Maps: sourceFilePath → lineNumber → Set<testId> */
export interface CoverageMap {
  [filePath: string]: {
    [lineNumber: number]: Set<string>;
  };
}

/** Per-test coverage: testId → set of "filePath:lineNumber" */
export interface PerTestCoverage {
  [testId: string]: Set<string>;
}

// ── Line Decoration State ────────────────────────────────────────────
export enum LineState {
  CoveredPassing = 'coveredPassing',
  CoveredFailing = 'coveredFailing',
  Uncovered = 'uncovered',
  NotInstrumented = 'notInstrumented',
}

export interface LineDecoration {
  line: number;
  state: LineState;
  testIds: string[];
}

// ── Queue ────────────────────────────────────────────────────────────
export interface QueueItem {
  id: string;
  testIds: string[];
  projectPath: string;
  reason: string;           // e.g. "File changed: MyService.cs"
  status: 'queued' | 'running' | 'completed' | 'failed';
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

// ── Test Project ─────────────────────────────────────────────────────
export interface TestProject {
  name: string;
  projectPath: string;       // path to .csproj
  framework: 'xunit' | 'nunit' | 'mstest' | 'unknown';
  tests: Map<string, TestInfo>;
}

// ── Engine State ─────────────────────────────────────────────────────
export enum EngineState {
  Stopped = 'stopped',
  Starting = 'starting',
  Running = 'running',
  Busy = 'busy',
}

// ── Configuration ────────────────────────────────────────────────────
export interface CrunchConfig {
  autoStart: boolean;
  debounceMs: number;
  runOnSave: boolean;
  runOnChange: boolean;
  runMode: 'automatic' | 'manual';
  testScope: 'all' | 'impactOnly';
  maxParallelRuns: number;
  coverageThreshold: number;
  excludePatterns: string[];
  dotnetPath: string;
  showGutterMarkers: boolean;
  showCodeLens: boolean;
  verboseOutput: boolean;
}

export function loadConfig(): CrunchConfig {
  const cfg = vscode.workspace.getConfiguration('dotnetCrunch');
  return {
    autoStart: cfg.get<boolean>('autoStart', true),
    debounceMs: cfg.get<number>('debounceMs', 500),
    runOnSave: cfg.get<boolean>('runOnSave', true),
    runOnChange: cfg.get<boolean>('runOnChange', false),
    runMode: cfg.get<'automatic' | 'manual'>('runMode', 'automatic'),
    testScope: cfg.get<'all' | 'impactOnly'>('testScope', 'impactOnly'),
    maxParallelRuns: cfg.get<number>('maxParallelRuns', 2),
    coverageThreshold: cfg.get<number>('coverageThreshold', 80),
    excludePatterns: cfg.get<string[]>('excludePatterns', ['**/obj/**', '**/bin/**', '**/Migrations/**']),
    dotnetPath: cfg.get<string>('dotnetPath', 'dotnet'),
    showGutterMarkers: cfg.get<boolean>('showGutterMarkers', true),
    showCodeLens: cfg.get<boolean>('showCodeLens', true),
    verboseOutput: cfg.get<boolean>('verboseOutput', false),
  };
}

// ── Events ───────────────────────────────────────────────────────────
export interface EngineEvents {
  onTestsDiscovered: vscode.Event<TestInfo[]>;
  onTestRunStarted: vscode.Event<QueueItem>;
  onTestRunCompleted: vscode.Event<QueueItem>;
  onTestResultUpdated: vscode.Event<TestResult>;
  onCoverageUpdated: vscode.Event<FileCoverage[]>;
  onEngineStateChanged: vscode.Event<EngineState>;
}
