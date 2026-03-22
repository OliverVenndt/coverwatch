import * as vscode from 'vscode';

let outputChannel: vscode.OutputChannel;
let verbose = false;

export function initLogger(channel: vscode.OutputChannel, isVerbose: boolean): void {
  outputChannel = channel;
  verbose = isVerbose;
}

export function setVerbose(v: boolean): void {
  verbose = v;
}

function timestamp(): string {
  return new Date().toISOString().substring(11, 23);
}

export function log(message: string): void {
  outputChannel.appendLine(`[${timestamp()}] ${message}`);
}

export function logVerbose(message: string): void {
  if (verbose) {
    outputChannel.appendLine(`[${timestamp()}] [VERBOSE] ${message}`);
  }
}

export function logError(message: string, error?: unknown): void {
  const errMsg = error instanceof Error ? error.message : String(error ?? '');
  outputChannel.appendLine(`[${timestamp()}] [ERROR] ${message}${errMsg ? ': ' + errMsg : ''}`);
  if (error instanceof Error && error.stack && verbose) {
    outputChannel.appendLine(error.stack);
  }
}

export function logWarn(message: string): void {
  outputChannel.appendLine(`[${timestamp()}] [WARN] ${message}`);
}
