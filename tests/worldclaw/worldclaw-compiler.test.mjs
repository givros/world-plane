import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assertLinkedSpecificationFilesExist,
  canonicalStringify,
  compileWorld,
  compileWorldFromInputs,
  discoverChunkDescriptorPaths,
  float32EdgeHash,
  hashRuntimeWorldChunkContent,
  hashRuntimeWorldChunkHeightSamples,
  loadWorldInputs,
  validateSharedEdgePair,
  validateWorldInputs,
  WorldClawValidationError,
} from '../../scripts/worldclaw/worldclaw-compiler.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const FIXTURES = path.join(import.meta.dirname, 'fixtures');

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function clone(value) {
  return structuredClone(value);
}

function deepMerge(base, overlay) {
  if (Array.isArray(overlay) || overlay === null || typeof overlay !== 'object') return clone(overlay);
  const result = clone(base);
  for (const [key, value] of Object.entries(overlay)) {
    result[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? deepMerge(result[key] ?? {}, value)
      : clone(value);
  }
  return result;
}

function assertValidationFailure(callback, expectedPattern) {
  assert.throws(callback, (error) => {
    assert.ok(error instanceof WorldClawValidationError);
    assert.match(error.message, expectedPattern);
    return true;
  });
}

function retargetDescriptor(base, {
  descriptorId,
  chunkX,
  chunkZ,
  descriptorPath,
  ready = false,
}) {
  const descriptor = clone(base);
  const size = descriptor.chunk.sizeMeters;
  const centerX = chunkX * size;
  const centerZ = chunkZ * size;
  descriptor.descriptorId = descriptorId;
  descriptor.chunk = {
    id: `chunk:${chunkX}:${chunkZ}`,
    coordinates: [chunkX, chunkZ],
    center: [centerX, 0, centerZ],
    boundsXZ: {
      minimum: [centerX - size * 0.5, centerZ - size * 0.5],
      maximum: [centerX + size * 0.5, centerZ + size * 0.5],
    },
    sizeMeters: size,
  };
  descriptor.runtimeRecordIdentity.chunkX = chunkX;
  descriptor.runtimeRecordIdentity.chunkZ = chunkZ;
  descriptor.artifactPaths.descriptor = descriptorPath;
  descriptor.terrain.sharedEdges = [
    ['north', chunkX, chunkZ - 1, 'south'],
    ['east', chunkX + 1, chunkZ, 'west'],
    ['south', chunkX, chunkZ + 1, 'north'],
    ['west', chunkX - 1, chunkZ, 'east'],
  ].map(([edge, neighborX, neighborZ, neighborEdge]) => ({
    edge,
    neighborChunkId: `chunk:${neighborX}:${neighborZ}`,
    neighborEdge,
    sampleCount: 41,
    validation: 'float32-bit-identical',
    payloadHash: ready ? '0'.repeat(64) : null,
  }));
  if (ready) {
    const heightSamples = Array.from(
      { length: 1681 },
      (_, index) => Math.fround((index % 41) * 0.125),
    );
    const heightHash = hashRuntimeWorldChunkHeightSamples(heightSamples);
    descriptor.runtimeRecordStatus = 'ready';
    descriptor.runtimeRecord = {
      ...descriptor.runtimeRecordIdentity,
      heightSamples,
      heightHash,
      contentHash: hashRuntimeWorldChunkContent({
        ...descriptor.runtimeRecordIdentity,
        heightHash,
      }),
    };
    descriptor.terrain.mode = 'authored-float32-grid';
  }
  return descriptor;
}

test('the checked source documents and near-airport pilot descriptor validate together', async () => {
  const inputs = await loadWorldInputs(ROOT);
  assert.deepEqual(validateWorldInputs(inputs, { rootDir: ROOT }), { valid: true });
  assert.deepEqual(await assertLinkedSpecificationFilesExist(ROOT, inputs.worldSpec), { valid: true });

  assert.deepEqual(inputs.pilotDescriptor.chunk.coordinates, [0, 1]);
  assert.deepEqual(inputs.pilotDescriptor.chunk.center, [0, 0, 1280]);
  assert.deepEqual(inputs.pilotDescriptor.chunk.boundsXZ, {
    minimum: [-640, 640],
    maximum: [640, 1920],
  });
  assert.deepEqual(
    inputs.pilotDescriptor.terrain.sharedEdges.map(({ edge, neighborChunkId }) => [edge, neighborChunkId]),
    [
      ['north', 'chunk:0:0'],
      ['east', 'chunk:1:1'],
      ['south', 'chunk:0:2'],
      ['west', 'chunk:-1:1'],
    ],
  );
});

test('descriptor discovery is recursive, deterministic, and tolerates an absent regions directory', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'planes3d-worldclaw-discovery-'));
  try {
    await mkdir(path.join(temporaryRoot, 'data/world/pilots/nested'), { recursive: true });
    await writeFile(path.join(temporaryRoot, 'data/world/pilots/z.json'), '{}', 'utf8');
    await writeFile(path.join(temporaryRoot, 'data/world/pilots/a.json'), '{}', 'utf8');
    await writeFile(path.join(temporaryRoot, 'data/world/pilots/nested/m.json'), '{}', 'utf8');
    assert.deepEqual(await discoverChunkDescriptorPaths(temporaryRoot), [
      'data/world/pilots/a.json',
      'data/world/pilots/nested/m.json',
      'data/world/pilots/z.json',
    ]);

    await mkdir(path.join(temporaryRoot, 'data/world/regions/sunlit-meadow/deep'), { recursive: true });
    await mkdir(path.join(temporaryRoot, 'data/world/regions/alpine-peaks'), { recursive: true });
    await writeFile(path.join(temporaryRoot, 'data/world/regions/sunlit-meadow/deep/b.json'), '{}', 'utf8');
    await writeFile(path.join(temporaryRoot, 'data/world/regions/alpine-peaks/a.json'), '{}', 'utf8');
    await writeFile(path.join(temporaryRoot, 'data/world/regions/alpine-peaks/ignore.txt'), '{}', 'utf8');
    assert.deepEqual(await discoverChunkDescriptorPaths(temporaryRoot), [
      'data/world/pilots/a.json',
      'data/world/pilots/nested/m.json',
      'data/world/pilots/z.json',
      'data/world/regions/alpine-peaks/a.json',
      'data/world/regions/sunlit-meadow/deep/b.json',
    ]);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('all discovered descriptors are emitted with deterministic per-biome readiness counts', async () => {
  const inputs = await loadWorldInputs(ROOT);
  inputs.pilotDescriptor.runtimeRecordStatus = 'identity-only-height-export-deferred';
  inputs.pilotDescriptor.runtimeRecord = null;
  inputs.pilotDescriptor.terrain.mode = 'procedural-identity';
  inputs.pilotDescriptor.terrain.sharedEdges.forEach((edge) => {
    edge.payloadHash = null;
  });
  inputs.chunkDescriptors = [{
    path: 'data/world/pilots/chunk_0_1.json',
    descriptor: inputs.pilotDescriptor,
  }];
  const descriptorPath = 'data/world/regions/arctic-tundra/chunk_-14_-5.json';
  const representative = retargetDescriptor(inputs.pilotDescriptor, {
    descriptorId: 'representative-arctic-tundra-negative',
    chunkX: -14,
    chunkZ: -5,
    descriptorPath,
    ready: true,
  });
  inputs.chunkDescriptors.push({ path: descriptorPath, descriptor: representative });

  const manifest = compileWorldFromInputs(inputs, { rootDir: ROOT });
  assert.deepEqual(manifest.chunkDescriptors.map(({ id, path: recordPath, ready }) => ({
    id,
    path: recordPath,
    ready,
  })), [
    {
      id: 'pilot-chunk-near-airport-arctic-tundra',
      path: 'data/world/pilots/chunk_0_1.json',
      ready: false,
    },
    {
      id: 'representative-arctic-tundra-negative',
      path: descriptorPath,
      ready: true,
    },
  ]);
  assert.deepEqual(manifest.biomeCoverage, [{
    biomeId: 'arctic-tundra',
    representativeCount: 2,
    readyCount: 1,
  }]);
  assert.equal(manifest.inventory.descriptorCount, 2);
  assert.equal(manifest.inventory.readyDescriptorCount, 1);
  assert.equal(manifest.inventory.representedBiomeCount, 1);
  assert.equal(manifest.pilot.id, 'pilot-chunk-near-airport-arctic-tundra');
  assert.equal(manifest.pilot.runtimeRecordAvailable, false);
});

test('duplicate descriptor IDs and chunk coordinates fail closed across directories', async () => {
  const duplicateIdInputs = await loadWorldInputs(ROOT);
  const duplicateIdPath = 'data/world/regions/arctic-tundra/chunk_-14_-5.json';
  duplicateIdInputs.chunkDescriptors.push({
    path: duplicateIdPath,
    descriptor: retargetDescriptor(duplicateIdInputs.pilotDescriptor, {
      descriptorId: duplicateIdInputs.pilotDescriptor.descriptorId,
      chunkX: -14,
      chunkZ: -5,
      descriptorPath: duplicateIdPath,
    }),
  });
  assertValidationFailure(
    () => compileWorldFromInputs(duplicateIdInputs),
    /duplicate descriptor ID pilot-chunk-near-airport-arctic-tundra/,
  );

  const duplicateCoordinatesInputs = await loadWorldInputs(ROOT);
  const duplicateCoordinatesPath = 'data/world/regions/arctic-tundra/chunk_0_1-copy.json';
  duplicateCoordinatesInputs.chunkDescriptors.push({
    path: duplicateCoordinatesPath,
    descriptor: retargetDescriptor(duplicateCoordinatesInputs.pilotDescriptor, {
      descriptorId: 'representative-duplicate-coordinate',
      chunkX: 0,
      chunkZ: 1,
      descriptorPath: duplicateCoordinatesPath,
    }),
  });
  assertValidationFailure(
    () => compileWorldFromInputs(duplicateCoordinatesInputs),
    /duplicate chunk coordinates 0:1/,
  );
});

test('compiler output is canonical, timestamp-free, deterministic, and Vite-base-safe', async () => {
  const first = await compileWorld(ROOT);
  const second = await compileWorld(ROOT);
  assert.deepEqual(first, second);
  assert.equal(first.manifestHash, second.manifestHash);
  assert.match(first.manifestHash, /^[0-9a-f]{64}$/);
  assert.match(first.sourceSetHash, /^[0-9a-f]{64}$/);
  assert.equal(first.pilot.chunkId, 'chunk:0:1');
  assert.equal(first.biomeCoverage.length, 14);
  assert.deepEqual(first.biomeCoverage.find(({ biomeId }) => biomeId === 'sunlit-meadow'), {
    biomeId: 'sunlit-meadow',
    representativeCount: 1,
    readyCount: 1,
  });
  assert.deepEqual(first.biomeCoverage.find(({ biomeId }) => biomeId === 'arctic-tundra'), {
    biomeId: 'arctic-tundra',
    representativeCount: 3,
    readyCount: 3,
  });
  assert.deepEqual(first.biomeCoverage.find(({ biomeId }) => biomeId === 'volcanic-wastes'), {
    biomeId: 'volcanic-wastes',
    representativeCount: 2,
    readyCount: 2,
  });
  assert.ok(
    first.biomeCoverage
      .filter(({ biomeId }) => ![
        'arctic-tundra',
        'sunlit-meadow',
        'volcanic-wastes',
      ].includes(biomeId))
      .every(({ representativeCount, readyCount }) =>
        representativeCount === 1 && readyCount === 1),
  );
  assert.equal(first.inventory.descriptorCount, 17);
  assert.equal(first.inventory.readyDescriptorCount, 17);
  assert.equal(first.inventory.representedBiomeCount, 14);
  assert.equal(first.pilot.runtimeRecordAvailable, true);
  assert.equal(first.runtimePaths.resolution, 'import.meta.env.BASE_URL');
  assert.deepEqual(first.runtimePaths.supportedBases, [
    {
      baseUrl: '/',
      manifestUrl: '/data/world/compiled/world_manifest.json',
      pilotDescriptorUrl: '/data/world/pilots/chunk_0_1.json',
    },
    {
      baseUrl: '/world-plane/',
      manifestUrl: '/world-plane/data/world/compiled/world_manifest.json',
      pilotDescriptorUrl: '/world-plane/data/world/pilots/chunk_0_1.json',
    },
  ]);

  const serialized = canonicalStringify(first, { pretty: true });
  assert.doesNotMatch(serialized, /"(?:generatedAt|compiledAt|createdAt|timestamp)"/i);
  assert.deepEqual(JSON.parse(serialized), first);

  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'planes3d-worldclaw-'));
  try {
    const outputPath = path.join(temporaryDirectory, 'world_manifest.json');
    await writeFile(outputPath, serialized, 'utf8');
    assert.deepEqual(JSON.parse(await readFile(outputPath, 'utf8')), first);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('a valid chunk-local transform preserves exact matrix inputs and linear instance color', async () => {
  const inputs = await loadWorldInputs(ROOT);
  inputs.pilotDescriptor.prototypeBatches = [{
    assetId: 'proto-biome-rock',
    transforms: [{
      translation: [-639.5, 12.25, 640],
      rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2],
      scale: [1, 2, 0.5],
      colorLinearRgb: [0.25, 0.3, 0.2],
    }],
  }];
  assert.doesNotThrow(() => compileWorldFromInputs(inputs, { rootDir: ROOT }));
});

test('a populated record uses the exact Stage2 AuthoredWorldChunkRecord fields and hashes', async () => {
  const inputs = await loadWorldInputs(ROOT);
  const identity = inputs.pilotDescriptor.runtimeRecordIdentity;
  const heightSamples = Array.from({ length: 1681 }, (_, index) => Math.fround((index % 41) * 0.125));
  const heightHash = hashRuntimeWorldChunkHeightSamples(heightSamples);
  const contentHash = hashRuntimeWorldChunkContent({ ...identity, heightHash });
  inputs.pilotDescriptor.runtimeRecordStatus = 'ready';
  inputs.pilotDescriptor.runtimeRecord = {
    ...identity,
    heightSamples,
    heightHash,
    contentHash,
  };
  inputs.pilotDescriptor.terrain.mode = 'authored-float32-grid';
  inputs.pilotDescriptor.terrain.sharedEdges.forEach((edge) => {
    edge.payloadHash = '0'.repeat(64);
  });
  assert.doesNotThrow(() => compileWorldFromInputs(inputs, { rootDir: ROOT }));

  inputs.pilotDescriptor.runtimeRecord.contentHash = 'fnv1a32:00000000';
  assertValidationFailure(() => compileWorldFromInputs(inputs), /runtimeRecord.contentHash: expected fnv1a32:/);
});

test('origin reserve, local bounds, quaternion, and capacity violations are rejected', async () => {
  const original = await loadWorldInputs(ROOT);
  const overlay = await readJson(path.join(FIXTURES, 'origin-reserve-invalid-overlay.json'));
  const originInputs = clone(original);
  originInputs.pilotDescriptor = deepMerge(originInputs.pilotDescriptor, overlay);
  originInputs.pilotDescriptor.chunk.id = 'chunk:0:0';
  originInputs.pilotDescriptor.terrain.sharedEdges = [
    ['north', 'chunk:0:-1', 'south'],
    ['east', 'chunk:1:0', 'west'],
    ['south', 'chunk:0:1', 'north'],
    ['west', 'chunk:-1:0', 'east'],
  ].map(([edge, neighborChunkId, neighborEdge]) => ({
    edge,
    neighborChunkId,
    neighborEdge,
    sampleCount: 41,
    validation: 'float32-bit-identical',
    payloadHash: null,
  }));
  originInputs.worldSpec.pilot.chunkId = 'chunk:0:0';
  originInputs.worldSpec.pilot.chunkCoordinates = [0, 0];
  originInputs.regionGraph.pilot.chunkId = 'chunk:0:0';
  originInputs.regionGraph.pilot.chunkCoordinates = [0, 0];
  assertValidationFailure(() => compileWorldFromInputs(originInputs), /protected origin reserve/);

  const badBounds = clone(original);
  badBounds.pilotDescriptor.prototypeBatches = [{
    assetId: 'proto-biome-rock',
    transforms: [{
      translation: [640.01, 0, 0],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
      colorLinearRgb: [0.2, 0.2, 0.2],
    }],
  }];
  assertValidationFailure(() => compileWorldFromInputs(badBounds), /chunk-local X\/Z/);

  const badQuaternion = clone(original);
  badQuaternion.pilotDescriptor.prototypeBatches = [{
    assetId: 'proto-biome-rock',
    transforms: [{
      translation: [0, 0, 0],
      rotation: [0, 0, 0, 2],
      scale: [1, 1, 1],
      colorLinearRgb: [0.2, 0.2, 0.2],
    }],
  }];
  assertValidationFailure(() => compileWorldFromInputs(badQuaternion), /quaternion must be normalized/);

  const excessive = clone(original);
  const transform = {
    translation: [0, 0, 0],
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
    colorLinearRgb: [0.2, 0.2, 0.2],
  };
  excessive.pilotDescriptor.prototypeBatches = [{
    assetId: 'proto-biome-rock',
    transforms: Array.from({ length: 2305 }, () => clone(transform)),
  }];
  assertValidationFailure(() => compileWorldFromInputs(excessive), /2305 exceeds capacity 2304/);
});

test('unknown references, duplicate IDs, and unsafe artifact paths fail closed', async () => {
  const original = await loadWorldInputs(ROOT);

  const unknownAsset = clone(original);
  unknownAsset.regionGraph.regions[1].repeatedAssetIds.push('proto-missing-regression');
  assertValidationFailure(() => compileWorldFromInputs(unknownAsset), /unknown asset ID proto-missing-regression/);

  const duplicateAsset = clone(original);
  duplicateAsset.assetRegistry.assets.push(clone(duplicateAsset.assetRegistry.assets[0]));
  assertValidationFailure(() => compileWorldFromInputs(duplicateAsset), /duplicate stable ID/);

  const unsafePath = clone(original);
  unsafePath.pilotDescriptor.artifactPaths.manifest = '/absolute/world_manifest.json';
  assertValidationFailure(() => compileWorldFromInputs(unsafePath), /does not match|Vite-safe/);
});

test('shared-edge hook accepts bit-identical float32 samples and rejects seams', async () => {
  const validPair = await readJson(path.join(FIXTURES, 'shared-edge-valid.json'));
  const valid = validateSharedEdgePair(validPair, { expectedSamples: 5 });
  assert.deepEqual(valid, {
    valid: true,
    sha256: float32EdgeHash(validPair.left.samples),
    sampleCount: 5,
  });

  const invalidPair = await readJson(path.join(FIXTURES, 'shared-edge-invalid.json'));
  assertValidationFailure(
    () => validateSharedEdgePair(invalidPair, { expectedSamples: 5 }),
    /float32 samples are not bit-identical/,
  );
});
