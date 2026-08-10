#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const DEFAULT_MANIFEST_PATH = 'data/world/compiled/world_manifest.json';
const DEFAULT_OUTPUT_PATH = 'src/world/generated/CompiledWorldManifest.generated.ts';
const RUNTIME_RECORD_KEYS = [
  'schemaVersion',
  'generatorVersion',
  'dataRevision',
  'worldSeed',
  'chunkX',
  'chunkZ',
  'biomeId',
  'heightSamples',
  'heightHash',
  'contentHash',
].sort(compareStable);

export class RuntimeModuleEmitterError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RuntimeModuleEmitterError';
  }
}

function compareStable(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonicalValue(value) {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new RuntimeModuleEmitterError('Canonical JSON cannot contain non-finite numbers.');
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort(compareStable)
        .map((key) => [key, canonicalValue(value[key])]),
    );
  }
  return value;
}

export function canonicalStringify(value) {
  return `${JSON.stringify(canonicalValue(value))}\n`;
}

export function canonicalSha256(value) {
  return createHash('sha256').update(canonicalStringify(value)).digest('hex');
}

function normalizeRepositoryPath(value) {
  return value.replaceAll('\\', '/');
}

function resolveRepositoryPath(rootDir, repositoryPath, label) {
  if (
    typeof repositoryPath !== 'string'
    || repositoryPath.length === 0
    || path.isAbsolute(repositoryPath)
    || repositoryPath.includes('\\')
    || repositoryPath.split('/').includes('..')
  ) {
    throw new RuntimeModuleEmitterError(`${label} must be a safe repository-relative path.`);
  }
  const absolutePath = path.resolve(rootDir, repositoryPath);
  const relativePath = path.relative(rootDir, absolutePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new RuntimeModuleEmitterError(`${label} escapes the repository root.`);
  }
  return absolutePath;
}

async function readJson(absolutePath, label) {
  let source;
  try {
    source = await readFile(absolutePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new RuntimeModuleEmitterError(`${label} is missing: ${absolutePath}`);
    }
    throw error;
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new RuntimeModuleEmitterError(`${label} is invalid JSON: ${error.message}`);
  }
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new RuntimeModuleEmitterError(`${label} must be a non-empty string.`);
  }
  return value;
}

function requireInteger(value, label, { minimum, maximum } = {}) {
  if (!Number.isSafeInteger(value)) {
    throw new RuntimeModuleEmitterError(`${label} must be a safe integer.`);
  }
  if (minimum !== undefined && value < minimum) {
    throw new RuntimeModuleEmitterError(`${label} must be at least ${minimum}.`);
  }
  if (maximum !== undefined && value > maximum) {
    throw new RuntimeModuleEmitterError(`${label} must be at most ${maximum}.`);
  }
  return value;
}

function validateManifest(manifest) {
  if (!isPlainObject(manifest)) {
    throw new RuntimeModuleEmitterError('Compiled manifest must be an object.');
  }
  const manifestHash = requireString(manifest.manifestHash, 'manifest.manifestHash');
  if (!/^[0-9a-f]{64}$/.test(manifestHash)) {
    throw new RuntimeModuleEmitterError('manifest.manifestHash must be a lowercase SHA-256 hash.');
  }
  const { manifestHash: ignoredManifestHash, ...manifestCore } = manifest;
  void ignoredManifestHash;
  const expectedManifestHash = canonicalSha256(manifestCore);
  if (manifestHash !== expectedManifestHash) {
    throw new RuntimeModuleEmitterError(
      `Compiled manifest hash mismatch: expected ${expectedManifestHash}, received ${manifestHash}.`,
    );
  }
  if (!Array.isArray(manifest.chunkDescriptors)) {
    throw new RuntimeModuleEmitterError('manifest.chunkDescriptors must be an array.');
  }
  if (!Array.isArray(manifest.biomeCoverage)) {
    throw new RuntimeModuleEmitterError('manifest.biomeCoverage must be an array.');
  }

  const descriptorIds = new Set();
  const descriptorPaths = new Set();
  const descriptorCoordinates = new Set();
  const representativeCounts = new Map();
  const readyCounts = new Map();
  const summaries = manifest.chunkDescriptors.map((entry, index) => {
    const label = `manifest.chunkDescriptors[${index}]`;
    if (!isPlainObject(entry)) throw new RuntimeModuleEmitterError(`${label} must be an object.`);
    const id = requireString(entry.id, `${label}.id`);
    const descriptorPath = normalizeRepositoryPath(requireString(entry.path, `${label}.path`));
    const biomeId = requireString(entry.biomeId, `${label}.biomeId`);
    if (!Array.isArray(entry.chunkCoordinates) || entry.chunkCoordinates.length !== 2) {
      throw new RuntimeModuleEmitterError(`${label}.chunkCoordinates must contain two integers.`);
    }
    const chunkX = requireInteger(entry.chunkCoordinates[0], `${label}.chunkCoordinates[0]`);
    const chunkZ = requireInteger(entry.chunkCoordinates[1], `${label}.chunkCoordinates[1]`);
    if (typeof entry.ready !== 'boolean') {
      throw new RuntimeModuleEmitterError(`${label}.ready must be boolean.`);
    }
    const runtimeRecordStatus = requireString(
      entry.runtimeRecordStatus,
      `${label}.runtimeRecordStatus`,
    );
    const descriptorHash = requireString(entry.sha256, `${label}.sha256`);
    if (!/^[0-9a-f]{64}$/.test(descriptorHash)) {
      throw new RuntimeModuleEmitterError(`${label}.sha256 must be a lowercase SHA-256 hash.`);
    }
    if (descriptorIds.has(id)) throw new RuntimeModuleEmitterError(`Duplicate descriptor ID ${id}.`);
    if (descriptorPaths.has(descriptorPath)) {
      throw new RuntimeModuleEmitterError(`Duplicate descriptor path ${descriptorPath}.`);
    }
    const coordinateKey = `${chunkX}:${chunkZ}`;
    if (descriptorCoordinates.has(coordinateKey)) {
      throw new RuntimeModuleEmitterError(`Duplicate descriptor chunk ${coordinateKey}.`);
    }
    descriptorIds.add(id);
    descriptorPaths.add(descriptorPath);
    descriptorCoordinates.add(coordinateKey);
    representativeCounts.set(biomeId, (representativeCounts.get(biomeId) ?? 0) + 1);
    if (entry.ready) readyCounts.set(biomeId, (readyCounts.get(biomeId) ?? 0) + 1);
    return {
      id,
      path: descriptorPath,
      biomeId,
      chunkCoordinates: [chunkX, chunkZ],
      ready: entry.ready,
      runtimeRecordStatus,
      sha256: descriptorHash,
    };
  }).sort((left, right) => compareStable(left.path, right.path));

  const coverageIds = new Set();
  const biomeCoverage = manifest.biomeCoverage.map((coverage, index) => {
    const label = `manifest.biomeCoverage[${index}]`;
    if (!isPlainObject(coverage)) throw new RuntimeModuleEmitterError(`${label} must be an object.`);
    const biomeId = requireString(coverage.biomeId, `${label}.biomeId`);
    const representativeCount = requireInteger(
      coverage.representativeCount,
      `${label}.representativeCount`,
      { minimum: 0 },
    );
    const readyCount = requireInteger(coverage.readyCount, `${label}.readyCount`, { minimum: 0 });
    if (coverageIds.has(biomeId)) {
      throw new RuntimeModuleEmitterError(`Duplicate biome coverage for ${biomeId}.`);
    }
    if (readyCount > representativeCount) {
      throw new RuntimeModuleEmitterError(`${label}.readyCount exceeds representativeCount.`);
    }
    if ((representativeCounts.get(biomeId) ?? 0) !== representativeCount) {
      throw new RuntimeModuleEmitterError(`${label}.representativeCount does not match descriptors.`);
    }
    if ((readyCounts.get(biomeId) ?? 0) !== readyCount) {
      throw new RuntimeModuleEmitterError(`${label}.readyCount does not match ready descriptors.`);
    }
    coverageIds.add(biomeId);
    return { biomeId, representativeCount, readyCount };
  }).sort((left, right) => compareStable(left.biomeId, right.biomeId));

  for (const biomeId of representativeCounts.keys()) {
    if (!coverageIds.has(biomeId)) {
      throw new RuntimeModuleEmitterError(`Manifest is missing biome coverage for ${biomeId}.`);
    }
  }
  const readySummaries = summaries.filter(({ ready }) => ready);
  if (readySummaries.length === 0) {
    throw new RuntimeModuleEmitterError('Compiled manifest contains no ready chunk descriptors.');
  }
  return { manifestHash, summaries, readySummaries, biomeCoverage };
}

function validateRuntimeRecord(record, label) {
  if (!isPlainObject(record)) {
    throw new RuntimeModuleEmitterError(`${label} is missing a ready runtime record.`);
  }
  const actualKeys = Object.keys(record).sort(compareStable);
  if (
    actualKeys.length !== RUNTIME_RECORD_KEYS.length
    || actualKeys.some((key, index) => key !== RUNTIME_RECORD_KEYS[index])
  ) {
    throw new RuntimeModuleEmitterError(`${label} does not match AuthoredWorldChunkRecord keys.`);
  }
  requireString(record.schemaVersion, `${label}.schemaVersion`);
  requireString(record.generatorVersion, `${label}.generatorVersion`);
  requireString(record.dataRevision, `${label}.dataRevision`);
  requireInteger(record.worldSeed, `${label}.worldSeed`, { minimum: 0, maximum: 0xffffffff });
  requireInteger(record.chunkX, `${label}.chunkX`);
  requireInteger(record.chunkZ, `${label}.chunkZ`);
  requireString(record.biomeId, `${label}.biomeId`);
  if (
    !Array.isArray(record.heightSamples)
    || record.heightSamples.length !== 1681
    || !record.heightSamples.every((sample) => typeof sample === 'number' && Number.isFinite(sample))
  ) {
    throw new RuntimeModuleEmitterError(`${label}.heightSamples must contain 1681 finite numbers.`);
  }
  requireString(record.heightHash, `${label}.heightHash`);
  requireString(record.contentHash, `${label}.contentHash`);
  return record;
}

function validatePrototypeBatches(batches, label) {
  if (!Array.isArray(batches)) {
    throw new RuntimeModuleEmitterError(`${label} must be an array.`);
  }
  batches.forEach((batch, batchIndex) => {
    if (!isPlainObject(batch) || typeof batch.assetId !== 'string' || !Array.isArray(batch.transforms)) {
      throw new RuntimeModuleEmitterError(`${label}[${batchIndex}] is not a prototype batch.`);
    }
  });
  return batches;
}

function encodeFloat32Payload(values, label) {
  const buffer = Buffer.allocUnsafe(values.length * Float32Array.BYTES_PER_ELEMENT);
  values.forEach((value, index) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new RuntimeModuleEmitterError(`${label}[${index}] must be finite.`);
    }
    if (!Object.is(Math.fround(value), value)) {
      throw new RuntimeModuleEmitterError(`${label}[${index}] must already be exact Float32.`);
    }
    buffer.writeFloatLE(Math.fround(value), index * Float32Array.BYTES_PER_ELEMENT);
  });
  return buffer.toString('base64');
}

function requireFloatTuple(value, length, label) {
  if (
    !Array.isArray(value)
    || value.length !== length
    || !value.every((component) => typeof component === 'number' && Number.isFinite(component))
  ) {
    throw new RuntimeModuleEmitterError(`${label} must contain ${length} finite numbers.`);
  }
  return value;
}

export function packRuntimeDescriptor(runtimeRecord, prototypeBatches, label = 'descriptor') {
  const { heightSamples, ...runtimeIdentity } = runtimeRecord;
  const packedBatches = prototypeBatches.map((batch, batchIndex) => {
    const transformFloats = [];
    batch.transforms.forEach((transform, transformIndex) => {
      const transformLabel = `${label}.prototypeBatches[${batchIndex}].transforms[${transformIndex}]`;
      transformFloats.push(
        ...requireFloatTuple(transform.translation, 3, `${transformLabel}.translation`),
        ...requireFloatTuple(transform.rotation, 4, `${transformLabel}.rotation`),
        ...requireFloatTuple(transform.scale, 3, `${transformLabel}.scale`),
        ...requireFloatTuple(transform.colorLinearRgb, 3, `${transformLabel}.colorLinearRgb`),
      );
    });
    return {
      assetId: batch.assetId,
      transformCount: batch.transforms.length,
      transformsFloat32Base64: encodeFloat32Payload(
        transformFloats,
        `${label}.prototypeBatches[${batchIndex}].transformFloats`,
      ),
    };
  });
  return {
    chunkKey: `${runtimeRecord.chunkX}:${runtimeRecord.chunkZ}`,
    runtimeRecord: {
      ...runtimeIdentity,
      heightSampleCount: heightSamples.length,
      heightSamplesFloat32Base64: encodeFloat32Payload(
        heightSamples,
        `${label}.runtimeRecord.heightSamples`,
      ),
    },
    prototypeBatches: packedBatches,
  };
}

function relativeModuleSpecifier(fromDirectory, targetPath, { stripTypeScriptExtension = false } = {}) {
  let relativePath = normalizeRepositoryPath(path.relative(fromDirectory, targetPath));
  if (stripTypeScriptExtension) relativePath = relativePath.replace(/\.ts$/u, '');
  if (!relativePath.startsWith('.')) relativePath = `./${relativePath}`;
  return relativePath;
}

export async function loadRuntimeModuleModel({
  rootDir,
  manifestPath = DEFAULT_MANIFEST_PATH,
  outputPath = DEFAULT_OUTPUT_PATH,
}) {
  const absoluteRoot = path.resolve(rootDir);
  const absoluteManifestPath = resolveRepositoryPath(absoluteRoot, manifestPath, 'manifestPath');
  const absoluteOutputPath = path.isAbsolute(outputPath)
    ? outputPath
    : path.resolve(absoluteRoot, outputPath);
  const manifest = await readJson(absoluteManifestPath, 'Compiled manifest');
  const validatedManifest = validateManifest(manifest);
  const outputDirectory = path.dirname(absoluteOutputPath);
  const typeImportPath = relativeModuleSpecifier(
    outputDirectory,
    path.resolve(absoluteRoot, 'src/world/WorldChunkSource.ts'),
    { stripTypeScriptExtension: true },
  );
  const descriptors = [];
  const chunkKeys = new Set();
  for (const summary of validatedManifest.readySummaries) {
    const absoluteDescriptorPath = resolveRepositoryPath(
      absoluteRoot,
      summary.path,
      `ready descriptor path ${summary.path}`,
    );
    const descriptor = await readJson(absoluteDescriptorPath, `Ready descriptor ${summary.path}`);
    const actualHash = canonicalSha256(descriptor);
    if (actualHash !== summary.sha256) {
      throw new RuntimeModuleEmitterError(
        `Ready descriptor ${summary.path} hash mismatch: expected ${summary.sha256}, received ${actualHash}.`,
      );
    }
    if (descriptor.descriptorId !== summary.id) {
      throw new RuntimeModuleEmitterError(`Ready descriptor ${summary.path} ID does not match manifest.`);
    }
    if (descriptor.runtimeRecordStatus !== 'ready') {
      throw new RuntimeModuleEmitterError(`Ready descriptor ${summary.path} has non-ready status.`);
    }
    if (descriptor.artifactPaths?.descriptor !== summary.path) {
      throw new RuntimeModuleEmitterError(`Ready descriptor ${summary.path} has a mismatched artifact path.`);
    }
    const runtimeRecord = validateRuntimeRecord(
      descriptor.runtimeRecord,
      `Ready descriptor ${summary.path}.runtimeRecord`,
    );
    if (
      runtimeRecord.chunkX !== summary.chunkCoordinates[0]
      || runtimeRecord.chunkZ !== summary.chunkCoordinates[1]
      || runtimeRecord.biomeId !== summary.biomeId
    ) {
      throw new RuntimeModuleEmitterError(`Ready descriptor ${summary.path} runtime identity does not match manifest.`);
    }
    const prototypeBatches = validatePrototypeBatches(
      descriptor.prototypeBatches,
      `Ready descriptor ${summary.path}.prototypeBatches`,
    );
    const chunkKey = `${runtimeRecord.chunkX}:${runtimeRecord.chunkZ}`;
    if (chunkKeys.has(chunkKey)) {
      throw new RuntimeModuleEmitterError(`Duplicate ready runtime chunk ${chunkKey}.`);
    }
    chunkKeys.add(chunkKey);
    descriptors.push({
      chunkKey,
      runtimeRecord,
      prototypeBatches,
      packedDescriptor: packRuntimeDescriptor(
        runtimeRecord,
        prototypeBatches,
        `Ready descriptor ${summary.path}`,
      ),
      summary,
    });
  }
  return {
    outputPath: absoluteOutputPath,
    typeImportPath,
    manifestHash: validatedManifest.manifestHash,
    descriptorSummaries: validatedManifest.summaries,
    biomeCoverage: validatedManifest.biomeCoverage,
    descriptors,
  };
}

function prettyLiteral(value, indentation = 0) {
  const padding = ' '.repeat(indentation);
  return JSON.stringify(value, null, 2)
    .split('\n')
    .map((line, index) => index === 0 ? line : `${padding}${line}`)
    .join('\n');
}

export function renderRuntimeModule(model) {
  const packedDescriptorsLiteral = JSON.stringify(
    model.descriptors.map(({ packedDescriptor }) => packedDescriptor),
  );
  const summariesLiteral = prettyLiteral(model.descriptorSummaries, 2);
  const coverageLiteral = prettyLiteral(model.biomeCoverage, 2);

  return `// Generated by scripts/worldclaw/emit-runtime-module.mjs. Do not edit.\n\nimport type {\n  AuthoredWorldChunkRecord,\n  WorldChunkPrototypeBatch,\n  WorldChunkPrototypeBatchesByChunk,\n  WorldChunkPrototypeTransform,\n} from ${JSON.stringify(model.typeImportPath)};\n\ntype PackedRuntimeRecord = Readonly<Omit<AuthoredWorldChunkRecord, "heightSamples"> & {\n  heightSampleCount: number;\n  heightSamplesFloat32Base64: string;\n}>;\n\ntype PackedPrototypeBatch = Readonly<{\n  assetId: string;\n  transformCount: number;\n  transformsFloat32Base64: string;\n}>;\n\ntype PackedCompiledDescriptor = Readonly<{\n  chunkKey: string;\n  runtimeRecord: PackedRuntimeRecord;\n  prototypeBatches: readonly PackedPrototypeBatch[];\n}>;\n\nconst FLOATS_PER_PROTOTYPE_TRANSFORM = 13;\nconst PACKED_COMPILED_DESCRIPTORS: readonly PackedCompiledDescriptor[] = ${packedDescriptorsLiteral};\n\nfunction decodeFloat32Payload(encoded: string, expectedValues: number): Float32Array {\n  const binary = globalThis.atob(encoded);\n  const expectedBytes = expectedValues * Float32Array.BYTES_PER_ELEMENT;\n  if (binary.length !== expectedBytes) {\n    throw new Error(\`Invalid compiled WorldClaw Float32 payload: expected \${expectedBytes} bytes, received \${binary.length}.\`);\n  }\n  const bytes = new Uint8Array(expectedBytes);\n  for (let index = 0; index < expectedBytes; index += 1) {\n    bytes[index] = binary.charCodeAt(index);\n  }\n  const view = new DataView(bytes.buffer);\n  const values = new Float32Array(expectedValues);\n  for (let index = 0; index < expectedValues; index += 1) {\n    values[index] = view.getFloat32(index * Float32Array.BYTES_PER_ELEMENT, true);\n  }\n  return values;\n}\n\nfunction decodeRuntimeRecord(packed: PackedRuntimeRecord): AuthoredWorldChunkRecord {\n  const {\n    heightSampleCount,\n    heightSamplesFloat32Base64,\n    ...identity\n  } = packed;\n  return Object.freeze({\n    ...identity,\n    heightSamples: decodeFloat32Payload(\n      heightSamplesFloat32Base64,\n      heightSampleCount,\n    ),\n  });\n}\n\nfunction decodePrototypeBatch(packed: PackedPrototypeBatch): WorldChunkPrototypeBatch {\n  const values = decodeFloat32Payload(\n    packed.transformsFloat32Base64,\n    packed.transformCount * FLOATS_PER_PROTOTYPE_TRANSFORM,\n  );\n  const transforms: WorldChunkPrototypeTransform[] = [];\n  for (let index = 0; index < packed.transformCount; index += 1) {\n    const offset = index * FLOATS_PER_PROTOTYPE_TRANSFORM;\n    transforms.push(Object.freeze({\n      translation: [values[offset], values[offset + 1], values[offset + 2]],\n      rotation: [\n        values[offset + 3],\n        values[offset + 4],\n        values[offset + 5],\n        values[offset + 6],\n      ],\n      scale: [values[offset + 7], values[offset + 8], values[offset + 9]],\n      colorLinearRgb: [values[offset + 10], values[offset + 11], values[offset + 12]],\n    }));\n  }\n  return Object.freeze({\n    assetId: packed.assetId,\n    transforms: Object.freeze(transforms),\n  });\n}\n\nexport type CompiledWorldDescriptorSummary = Readonly<{\n  id: string;\n  path: string;\n  biomeId: string;\n  chunkCoordinates: readonly [number, number];\n  ready: boolean;\n  runtimeRecordStatus: string;\n  sha256: string;\n}>;\n\nexport type CompiledWorldBiomeCoverage = Readonly<{\n  biomeId: string;\n  representativeCount: number;\n  readyCount: number;\n}>;\n\nexport const COMPILED_WORLD_MANIFEST_HASH = ${JSON.stringify(model.manifestHash)} as const;\n\nexport const COMPILED_WORLD_DESCRIPTOR_SUMMARIES = Object.freeze(\n  ${summariesLiteral} as const,\n) satisfies readonly CompiledWorldDescriptorSummary[];\n\nexport const COMPILED_WORLD_BIOME_COVERAGE = Object.freeze(\n  ${coverageLiteral} as const,\n) satisfies readonly CompiledWorldBiomeCoverage[];\n\nexport const COMPILED_AUTHORED_WORLD_CHUNK_RECORDS: readonly AuthoredWorldChunkRecord[] = Object.freeze(\n  PACKED_COMPILED_DESCRIPTORS.map(({ runtimeRecord }) =>\n    decodeRuntimeRecord(runtimeRecord)),\n);\n\nexport const COMPILED_PROTOTYPE_BATCHES_BY_CHUNK: WorldChunkPrototypeBatchesByChunk = Object.freeze(\n  Object.fromEntries(\n    PACKED_COMPILED_DESCRIPTORS.map(({ chunkKey, prototypeBatches }) => [\n      chunkKey,\n      Object.freeze(prototypeBatches.map(decodePrototypeBatch)),\n    ]),\n  ),\n);\n`;
}

export async function emitRuntimeModule({
  rootDir = process.cwd(),
  manifestPath = DEFAULT_MANIFEST_PATH,
  outputPath = DEFAULT_OUTPUT_PATH,
  check = false,
} = {}) {
  const model = await loadRuntimeModuleModel({ rootDir, manifestPath, outputPath });
  const source = renderRuntimeModule(model);
  if (check) {
    let existing;
    try {
      existing = await readFile(model.outputPath, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw new RuntimeModuleEmitterError(`Generated runtime module is missing: ${model.outputPath}`);
      }
      throw error;
    }
    if (existing !== source) {
      throw new RuntimeModuleEmitterError(
        `Generated runtime module is stale: ${model.outputPath}. Run the emitter with --out.`,
      );
    }
    return { outputPath: model.outputPath, source, checked: true, manifestHash: model.manifestHash };
  }
  await mkdir(path.dirname(model.outputPath), { recursive: true });
  await writeFile(model.outputPath, source, 'utf8');
  return { outputPath: model.outputPath, source, checked: false, manifestHash: model.manifestHash };
}

function usage() {
  return [
    'Usage: node scripts/worldclaw/emit-runtime-module.mjs [options]',
    '',
    'Options:',
    '  --root <path>  Repository root (default: current directory)',
    '  --out <path>   Output module (default: src/world/generated/CompiledWorldManifest.generated.ts)',
    '  --check        Compare generated bytes without writing',
    '  --help         Show this message',
  ].join('\n');
}

function parseArguments(argv) {
  const options = { rootDir: process.cwd(), outputPath: DEFAULT_OUTPUT_PATH, check: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--root') options.rootDir = path.resolve(argv[++index] ?? '');
    else if (argument === '--out') options.outputPath = argv[++index] ?? '';
    else if (argument === '--check') options.check = true;
    else if (argument === '--help') options.help = true;
    else throw new RuntimeModuleEmitterError(`Unknown argument: ${argument}`);
  }
  if (!options.outputPath) throw new RuntimeModuleEmitterError('--out requires a path.');
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const result = await emitRuntimeModule(options);
  const action = result.checked ? 'verified' : 'wrote';
  process.stdout.write(`WorldClaw runtime module ${action}: ${result.outputPath}\n`);
}

const invokedAsScript = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedAsScript) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
