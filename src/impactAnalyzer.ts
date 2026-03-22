import * as vscode from 'vscode';
import { CoverageStore } from './coverageMap';
import { TestDiscovery } from './testDiscovery';
import { log, logVerbose } from './logger';

export interface ImpactResult {
  affectedTestIds: string[];
  reason: string;
  isFullRun: boolean;
}

/**
 * Determines which tests need to run based on file changes.
 *
 * Strategy:
 * 1. If coverage map has data for the changed file → look up affected lines → return tests
 * 2. If the changed file is a test file itself → return tests in that file
 * 3. If no coverage data → return all tests in the project (conservative fallback)
 */
export class ImpactAnalyzer {
  constructor(
    private coverageStore: CoverageStore,
    private testDiscovery: TestDiscovery,
  ) {}

  /**
   * Analyze a file change and determine which tests to run.
   */
  analyzeChange(filePath: string, changedLines?: number[]): ImpactResult {
    // 1. Is this a test file? If so, find matching tests.
    const testsInFile = this.findTestsInFile(filePath);
    if (testsInFile.length > 0) {
      logVerbose(`Change in test file → running ${testsInFile.length} tests from file`);
      return {
        affectedTestIds: testsInFile,
        reason: `Test file changed`,
        isFullRun: false,
      };
    }

    // 2. Do we have coverage data for this file?
    if (changedLines && changedLines.length > 0) {
      const affected = this.coverageStore.getAffectedTests(filePath, changedLines);
      if (affected.length > 0) {
        logVerbose(`Impact analysis: ${changedLines.length} changed lines → ${affected.length} affected tests`);
        return {
          affectedTestIds: affected,
          reason: `${changedLines.length} lines changed → ${affected.length} tests affected`,
          isFullRun: false,
        };
      }
    }

    // 3. Try all lines in the file from coverage map
    const allTestsForFile = this.coverageStore.getTestsForFile(filePath);
    if (allTestsForFile.length > 0) {
      logVerbose(`No line-level data but file is covered → running ${allTestsForFile.length} tests`);
      return {
        affectedTestIds: allTestsForFile,
        reason: `File changed, ${allTestsForFile.length} tests cover this file`,
        isFullRun: false,
      };
    }

    // 4. Fallback: find the project and run all its tests
    const projectPath = this.testDiscovery.findProjectForFile(filePath);
    if (projectPath) {
      const project = this.testDiscovery.testProjects.get(projectPath);
      if (project) {
        const allTestIds = Array.from(project.tests.keys());
        log(`No coverage data for file → running all ${allTestIds.length} tests in ${project.name}`);
        return {
          affectedTestIds: allTestIds,
          reason: `No coverage data — running all tests in ${project.name}`,
          isFullRun: true,
        };
      }
    }

    // 5. Nothing found
    logVerbose(`No tests found for changed file: ${filePath}`);
    return {
      affectedTestIds: [],
      reason: 'No associated tests found',
      isFullRun: false,
    };
  }

  /**
   * Detect changed lines between old and new content using a simple diff.
   */
  detectChangedLines(oldContent: string, newContent: string): number[] {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    const changed: number[] = [];

    const maxLen = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < maxLen; i++) {
      if (oldLines[i] !== newLines[i]) {
        changed.push(i + 1); // 1-based line numbers
      }
    }

    return changed;
  }

  /**
   * Find test IDs that are defined in a given source file.
   */
  private findTestsInFile(filePath: string): string[] {
    const allTests = this.testDiscovery.getAllTests();
    return allTests
      .filter(t => t.sourceFile === filePath)
      .map(t => t.testId);
  }
}
