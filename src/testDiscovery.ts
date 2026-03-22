import * as vscode from 'vscode';
import * as path from 'path';
import * as cp from 'child_process';
import { TestInfo, TestProject, TestStatus, CrunchConfig } from './types';
import { log, logVerbose, logError } from './logger';

/**
 * Discovers .NET test projects in the workspace and enumerates their tests.
 */
export class TestDiscovery {
  private projects: Map<string, TestProject> = new Map();

  constructor(private config: CrunchConfig) {}

  get testProjects(): Map<string, TestProject> {
    return this.projects;
  }

  /**
   * Scan the workspace for .csproj files that reference a test framework.
   */
  async discoverProjects(): Promise<TestProject[]> {
    const csprojFiles = await vscode.workspace.findFiles('**/*.csproj', '{**/obj/**,**/bin/**}');
    const discovered: TestProject[] = [];

    for (const uri of csprojFiles) {
      const content = (await vscode.workspace.fs.readFile(uri)).toString();
      const framework = this.detectFramework(content);
      if (framework !== 'unknown') {
        const proj: TestProject = {
          name: path.basename(uri.fsPath, '.csproj'),
          projectPath: uri.fsPath,
          framework,
          tests: new Map(),
        };
        this.projects.set(uri.fsPath, proj);
        discovered.push(proj);
        log(`Discovered test project: ${proj.name} (${framework})`);
      }
    }

    return discovered;
  }

  /**
   * Detect which test framework a .csproj references.
   */
  private detectFramework(csprojContent: string): TestProject['framework'] {
    const lower = csprojContent.toLowerCase();
    if (lower.includes('xunit') || lower.includes('xunit.core')) { return 'xunit'; }
    if (lower.includes('nunit') || lower.includes('nunit3testadapter')) { return 'nunit'; }
    if (lower.includes('mstest') || lower.includes('microsoft.net.test.sdk')) { return 'mstest'; }
    return 'unknown';
  }

  /**
   * List tests in a project using `dotnet test --list-tests`.
   */
  async discoverTests(projectPath: string): Promise<TestInfo[]> {
    const project = this.projects.get(projectPath);
    if (!project) { return []; }

    log(`Discovering tests in ${project.name}...`);

    return new Promise((resolve) => {
      const args = ['test', projectPath, '--list-tests', '--no-build', '-v', 'q'];
      const proc = cp.spawn(this.config.dotnetPath, args, {
        cwd: path.dirname(projectPath),
        env: { ...process.env },
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.stderr.on('data', (d) => { stderr += d.toString(); });

      proc.on('close', (code) => {
        if (code !== 0) {
          // --no-build might fail if not built; retry with build
          logVerbose(`--list-tests --no-build failed (code ${code}), retrying with build...`);
          this.discoverTestsWithBuild(projectPath).then(resolve);
          return;
        }

        const tests = this.parseTestList(stdout, project);
        project.tests = new Map(tests.map(t => [t.testId, t]));
        log(`Found ${tests.length} tests in ${project.name}`);
        resolve(tests);
      });

      proc.on('error', (err) => {
        logError(`Failed to discover tests in ${project.name}`, err);
        resolve([]);
      });
    });
  }

  private async discoverTestsWithBuild(projectPath: string): Promise<TestInfo[]> {
    const project = this.projects.get(projectPath);
    if (!project) { return []; }

    return new Promise((resolve) => {
      const args = ['test', projectPath, '--list-tests', '-v', 'q'];
      const proc = cp.spawn(this.config.dotnetPath, args, {
        cwd: path.dirname(projectPath),
      });

      let stdout = '';
      proc.stdout.on('data', (d) => { stdout += d.toString(); });

      proc.on('close', () => {
        const tests = this.parseTestList(stdout, project);
        project.tests = new Map(tests.map(t => [t.testId, t]));
        log(`Found ${tests.length} tests in ${project.name} (with build)`);
        resolve(tests);
      });

      proc.on('error', (err) => {
        logError(`Failed to discover tests in ${project.name}`, err);
        resolve([]);
      });
    });
  }

  /**
   * Parse the output of `dotnet test --list-tests`.
   * Format is:
   *   The following Tests are available:
   *       Namespace.Class.Method
   *       Namespace.Class.Method2
   */
  private parseTestList(output: string, project: TestProject): TestInfo[] {
    const lines = output.split('\n');
    const tests: TestInfo[] = [];
    let started = false;

    for (const raw of lines) {
      const line = raw.trim();
      if (line.startsWith('The following Tests are available') || line.startsWith('The following test')) {
        started = true;
        continue;
      }
      if (!started || line === '' || line.startsWith('Test run') || line.startsWith('Microsoft')) {
        continue;
      }

      const fqn = line;
      const parts = fqn.split('.');
      const methodName = parts[parts.length - 1] || fqn;
      const className = parts.length >= 2 ? parts[parts.length - 2] : '';

      const testId = `${project.projectPath}::${fqn}`;
      tests.push({
        testId,
        fullyQualifiedName: fqn,
        displayName: methodName,
        className,
        methodName,
        projectPath: project.projectPath,
        status: TestStatus.Unknown,
      });
    }

    return tests;
  }

  /**
   * Find the project path that a given source file belongs to.
   * Walks up directories to find the nearest .csproj.
   */
  findProjectForFile(filePath: string): string | undefined {
    for (const [projPath] of this.projects) {
      const projDir = path.dirname(projPath);
      if (filePath.startsWith(projDir)) {
        return projPath;
      }
    }
    // Fallback: find nearest csproj by directory walking
    let dir = path.dirname(filePath);
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    while (dir.length >= workspaceRoot.length) {
      for (const [projPath] of this.projects) {
        if (path.dirname(projPath) === dir) {
          return projPath;
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir) { break; }
      dir = parent;
    }
    return undefined;
  }

  /**
   * Get all tests across all projects.
   */
  getAllTests(): TestInfo[] {
    const all: TestInfo[] = [];
    for (const proj of this.projects.values()) {
      for (const test of proj.tests.values()) {
        all.push(test);
      }
    }
    return all;
  }

  updateConfig(config: CrunchConfig): void {
    this.config = config;
  }
}
