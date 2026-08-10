#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {
  assertLinkedSpecificationFilesExist,
  canonicalStringify,
  compileWorld,
  loadWorldInputs,
  WorldClawValidationError,
} from './worldclaw-compiler.mjs';

function usage() {
  return [
    'Usage: node scripts/worldclaw/compile-world.mjs [options]',
    '',
    'Options:',
    '  --root <path>   Repository root (default: current directory)',
    '  --check         Validate and hash without writing an artifact',
    '  --out <path>    Write the deterministic manifest to this path',
    '  --print         Print the complete canonical manifest',
    '  --help          Show this message',
  ].join('\n');
}

function parseArguments(argv) {
  const options = { rootDir: process.cwd(), check: false, print: false, outputPath: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--root') options.rootDir = path.resolve(argv[++index] ?? '');
    else if (argument === '--out') options.outputPath = argv[++index] ?? null;
    else if (argument === '--check') options.check = true;
    else if (argument === '--print') options.print = true;
    else if (argument === '--help') options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (options.outputPath) options.outputPath = path.resolve(options.rootDir, options.outputPath);
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const inputs = await loadWorldInputs(options.rootDir);
  await assertLinkedSpecificationFilesExist(options.rootDir, inputs.worldSpec);
  const manifest = await compileWorld(options.rootDir);
  const serialized = canonicalStringify(manifest, { pretty: true });
  if (options.outputPath) {
    await mkdir(path.dirname(options.outputPath), { recursive: true });
    await writeFile(options.outputPath, serialized, 'utf8');
  }
  if (options.print) process.stdout.write(serialized);
  if (!options.print) {
    const action = options.outputPath ? `wrote ${path.relative(options.rootDir, options.outputPath)}` : 'check only';
    process.stdout.write(`WorldClaw validation passed (${action}); manifest ${manifest.manifestHash}\n`);
  }
}

main().catch((error) => {
  if (error instanceof WorldClawValidationError) {
    process.stderr.write(`${error.message}\n`);
  } else {
    process.stderr.write(`${error.stack ?? error.message}\n`);
  }
  process.exitCode = 1;
});
