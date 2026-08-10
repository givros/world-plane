#!/usr/bin/env node
import { gzipSync } from 'node:zlib';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const WORLDCLAW_JAVASCRIPT_RAW_BUDGET_BYTES = 1_400_000;
export const WORLDCLAW_JAVASCRIPT_GZIP_BUDGET_BYTES = 550_000;

async function collectJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectJavaScriptFiles(absolutePath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(absolutePath);
    }
  }
  return files.sort((first, second) => first.localeCompare(second));
}

export async function checkWorldClawBundleBudget({
  directory = path.resolve('dist'),
  rawBudgetBytes = WORLDCLAW_JAVASCRIPT_RAW_BUDGET_BYTES,
  gzipBudgetBytes = WORLDCLAW_JAVASCRIPT_GZIP_BUDGET_BYTES,
} = {}) {
  const files = await collectJavaScriptFiles(directory);
  if (files.length === 0) {
    throw new Error(`No production JavaScript files found under ${directory}.`);
  }
  let rawBytes = 0;
  let gzipBytes = 0;
  for (const filePath of files) {
    const source = await readFile(filePath);
    rawBytes += source.byteLength;
    gzipBytes += gzipSync(source).byteLength;
  }
  if (rawBytes > rawBudgetBytes || gzipBytes > gzipBudgetBytes) {
    throw new Error(
      `Production JavaScript exceeds the WorldClaw budget: `
      + `${rawBytes}/${rawBudgetBytes} raw bytes, `
      + `${gzipBytes}/${gzipBudgetBytes} gzip bytes.`,
    );
  }
  return {
    files: files.map((filePath) => path.relative(directory, filePath).replaceAll('\\', '/')),
    rawBytes,
    rawBudgetBytes,
    gzipBytes,
    gzipBudgetBytes,
  };
}

async function main() {
  const result = await checkWorldClawBundleBudget();
  process.stdout.write(
    `WorldClaw bundle budget passed: ${result.rawBytes}/${result.rawBudgetBytes} raw bytes, `
    + `${result.gzipBytes}/${result.gzipBudgetBytes} gzip bytes across `
    + `${result.files.length} JavaScript file(s).\n`,
  );
}

const invokedAsScript = process.argv[1]
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedAsScript) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
