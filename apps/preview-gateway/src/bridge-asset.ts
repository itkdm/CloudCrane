import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

let scriptPromise: Promise<string> | undefined;

export function previewBridgeScript(): Promise<string> {
  scriptPromise ??= readFile(
    fileURLToPath(import.meta.resolve('@cloudcrane/preview-bridge/browser.js')),
    'utf8',
  );
  return scriptPromise;
}
