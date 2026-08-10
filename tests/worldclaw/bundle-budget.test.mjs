import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  checkWorldClawBundleBudget,
} from '../../scripts/worldclaw/check-bundle-budget.mjs';

test('bundle budget sums all generated JavaScript files and ignores other assets', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'planes3d-bundle-budget-'));
  try {
    const first = Buffer.from('export const first = 1;\n');
    const second = Buffer.from('export const second = "worldclaw";\n');
    await mkdir(path.join(directory, 'assets'), { recursive: true });
    await writeFile(path.join(directory, 'entry.js'), first);
    await writeFile(path.join(directory, 'assets', 'chunk.js'), second);
    await writeFile(path.join(directory, 'assets', 'style.css'), 'body {}\n');
    const result = await checkWorldClawBundleBudget({
      directory,
      rawBudgetBytes: 10_000,
      gzipBudgetBytes: 10_000,
    });
    assert.deepEqual(result.files, ['assets/chunk.js', 'entry.js']);
    assert.equal(result.rawBytes, first.byteLength + second.byteLength);
    assert.equal(
      result.gzipBytes,
      gzipSync(first).byteLength + gzipSync(second).byteLength,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('bundle budget fails closed for missing JavaScript and either exceeded limit', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'planes3d-bundle-budget-'));
  try {
    await assert.rejects(
      checkWorldClawBundleBudget({ directory }),
      /No production JavaScript files/,
    );
    await writeFile(path.join(directory, 'entry.js'), 'export const value = 1;\n');
    await assert.rejects(
      checkWorldClawBundleBudget({
        directory,
        rawBudgetBytes: 1,
        gzipBudgetBytes: 10_000,
      }),
      /exceeds the WorldClaw budget/,
    );
    await assert.rejects(
      checkWorldClawBundleBudget({
        directory,
        rawBudgetBytes: 10_000,
        gzipBudgetBytes: 1,
      }),
      /exceeds the WorldClaw budget/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
