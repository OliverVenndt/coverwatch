import * as vscode from 'vscode';
import * as path from 'path';
import { CoverwatchConfig } from './types';
import { logVerbose } from './logger';

/**
 * Watches for C# file changes and triggers callbacks with debouncing.
 */
export class FileWatcher implements vscode.Disposable {
  private watchers: vscode.Disposable[] = [];
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private previousContents: Map<string, string> = new Map();

  private readonly _onFileChanged = new vscode.EventEmitter<{
    filePath: string;
    oldContent: string;
    newContent: string;
  }>();
  readonly onFileChanged = this._onFileChanged.event;

  constructor(private config: CoverwatchConfig) {}

  /**
   * Start watching for .cs file changes.
   */
  start(): void {
    this.stop();

    // Always watch saves (needed for stale test detection even in manual mode)
    const saveWatcher = vscode.workspace.onDidSaveTextDocument((doc) => {
      if (this.shouldWatch(doc.uri)) {
        this.handleChange(doc);
      }
    });
    this.watchers.push(saveWatcher);

    if (this.config.runOnChange) {
      const changeWatcher = vscode.workspace.onDidChangeTextDocument((e) => {
        if (this.shouldWatch(e.document.uri) && e.contentChanges.length > 0) {
          this.handleChangeDebounced(e.document);
        }
      });
      this.watchers.push(changeWatcher);
    }

    // Track document opens for old content tracking
    const openWatcher = vscode.workspace.onDidOpenTextDocument((doc) => {
      if (this.shouldWatch(doc.uri)) {
        this.previousContents.set(doc.uri.fsPath, doc.getText());
      }
    });
    this.watchers.push(openWatcher);

    // Initialize already-open documents
    for (const doc of vscode.workspace.textDocuments) {
      if (this.shouldWatch(doc.uri)) {
        this.previousContents.set(doc.uri.fsPath, doc.getText());
      }
    }

    logVerbose(`File watcher started (onSave=${this.config.runOnSave}, onChange=${this.config.runOnChange})`);
  }

  /**
   * Stop watching.
   */
  stop(): void {
    for (const w of this.watchers) { w.dispose(); }
    this.watchers = [];
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  /**
   * Handle a file save immediately.
   */
  private handleChange(doc: vscode.TextDocument): void {
    const filePath = doc.uri.fsPath;
    const oldContent = this.previousContents.get(filePath) ?? '';
    const newContent = doc.getText();

    this.previousContents.set(filePath, newContent);

    if (oldContent !== newContent || oldContent === '') {
      logVerbose(`File changed: ${path.basename(filePath)}`);
      this._onFileChanged.fire({ filePath, oldContent, newContent });
    }
  }

  /**
   * Handle a file change with debounce (for runOnChange mode).
   */
  private handleChangeDebounced(doc: vscode.TextDocument): void {
    const filePath = doc.uri.fsPath;

    const existing = this.debounceTimers.get(filePath);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(filePath);
      this.handleChange(doc);
    }, this.config.debounceMs);

    this.debounceTimers.set(filePath, timer);
  }

  /**
   * Determine if a URI should be watched.
   */
  private shouldWatch(uri: vscode.Uri): boolean {
    if (uri.scheme !== 'file') { return false; }
    if (!uri.fsPath.endsWith('.cs')) { return false; }

    const fsPath = uri.fsPath;
    for (const pattern of this.config.excludePatterns) {
      // Simple glob matching for common patterns
      const normalized = pattern.replace(/\*\*/g, '').replace(/\*/g, '');
      if (fsPath.includes(normalized.replace(/\//g, path.sep))) {
        return false;
      }
    }

    return true;
  }

  updateConfig(config: CoverwatchConfig): void {
    this.config = config;
    // Restart with new config
    this.start();
  }

  dispose(): void {
    this.stop();
    this._onFileChanged.dispose();
  }
}
