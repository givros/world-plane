import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createServer } from 'vite';
import {
  WORLDCLAW_DEFAULT_SEED,
  WORLDCLAW_PILOT_DESCRIPTOR_PATH,
  WORLDCLAW_ROLLOUT_TARGETS,
} from '../../scripts/worldclaw/export-runtime-chunks.mjs';

const rootDir = path.resolve(import.meta.dirname, '../..');

function descriptorPath(target) {
  if (target.pilot) return WORLDCLAW_PILOT_DESCRIPTOR_PATH;
  return `data/world/regions/${target.biomeId}/chunk_${target.chunkX}_${target.chunkZ}.json`;
}

async function readDescriptor(target) {
  return JSON.parse(await readFile(path.resolve(rootDir, descriptorPath(target)), 'utf8'));
}

async function loadRuntimeModules() {
  const server = await createServer({
    root: rootDir,
    configFile: false,
    logLevel: 'silent',
    server: { middlewareMode: true },
  });
  const [sourceModule, worldModule, urbanModule] = await Promise.all([
    server.ssrLoadModule('/src/world/WorldChunkSource.ts'),
    server.ssrLoadModule('/src/world/InfiniteBiomeWorld.ts'),
    server.ssrLoadModule('/src/world/UrbanBiomeArt.ts'),
  ]);
  return { server, sourceModule, worldModule, urbanModule };
}

function float32Bytes(values) {
  const bytes = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => bytes.writeFloatLE(Math.fround(value), index * 4));
  return bytes;
}

function compositionMap(descriptors) {
  return Object.fromEntries(descriptors.map((descriptor) => [
    `${descriptor.runtimeRecord.chunkX}:${descriptor.runtimeRecord.chunkZ}`,
    descriptor.prototypeBatches,
  ]));
}

test('all rollout representatives match the runtime selector and round-trip exactly', async () => {
  const descriptors = await Promise.all(WORLDCLAW_ROLLOUT_TARGETS.map(readDescriptor));
  const { server, sourceModule, worldModule, urbanModule } = await loadRuntimeModules();
  try {
    const fallback = sourceModule.createProceduralWorldChunkSource({
      seed: WORLDCLAW_DEFAULT_SEED,
    });
    const source = sourceModule.createValidatedWorldChunkSource({
      fallback,
      authoredChunks: descriptors.map((descriptor) => descriptor.runtimeRecord),
      authoredPrototypeBatchesByChunk: compositionMap(descriptors),
    });
    const coveredBiomes = new Set();

    for (const [index, target] of WORLDCLAW_ROLLOUT_TARGETS.entries()) {
      const descriptor = descriptors[index];
      const procedural = fallback.resolveChunk(target.chunkX, target.chunkZ);
      const authored = source.resolveChunk(target.chunkX, target.chunkZ);
      assert.equal(procedural.biome.id, target.biomeId);
      assert.equal(authored.biome.id, target.biomeId);
      assert.equal(authored.resolution, 'authored');
      assert.equal(authored.heightHash, descriptor.runtimeRecord.heightHash);
      assert.equal(authored.contentHash, descriptor.runtimeRecord.contentHash);
      assert.deepEqual(
        float32Bytes(authored.heightSamples),
        float32Bytes(procedural.heightSamples),
      );
      assert.equal(
        authored.compositionHash,
        sourceModule.hashWorldChunkComposition(descriptor.prototypeBatches),
      );

      const naturalBatches = worldModule.createProceduralNaturalPrototypeBatches({
        chunkX: target.chunkX,
        chunkZ: target.chunkZ,
        seed: WORLDCLAW_DEFAULT_SEED,
        source: fallback,
      });
      const urbanBatches = urbanModule.createProceduralUrbanPrototypeBatches({
        biome: procedural.biome,
        chunkX: target.chunkX,
        chunkZ: target.chunkZ,
        chunkSize: 1280,
        seed: WORLDCLAW_DEFAULT_SEED,
        terrainHeight: (worldX, worldZ) =>
          sourceModule.sampleWorldChunkDescriptorHeight(procedural, worldX, worldZ),
        isReserved: (worldX, worldZ) => fallback.isReserved(worldX, worldZ),
      });
      const expectedBatches = [...naturalBatches, ...urbanBatches]
        .sort((first, second) => first.assetId.localeCompare(second.assetId));
      assert.deepEqual(authored.prototypeBatches, expectedBatches);
      coveredBiomes.add(authored.biome.id);
    }
    assert.equal(coveredBiomes.size, 14);
    const initialAuthoredChunkKeys = WORLDCLAW_ROLLOUT_TARGETS
      .filter(({ chunkX, chunkZ }) => Math.abs(chunkX) <= 1 && Math.abs(chunkZ) <= 1)
      .map(({ chunkX, chunkZ }) => `${chunkX}:${chunkZ}`)
      .sort();
    assert.deepEqual(initialAuthoredChunkKeys, [
      '-1:-1',
      '-1:0',
      '-1:1',
      '0:1',
      '1:-1',
      '1:0',
      '1:1',
    ]);
    assert.equal(source.resolveChunk(0, 0).resolution, 'procedural');
    assert.equal(source.resolveChunk(0, 1).resolution, 'authored');
    assert.equal(source.resolveChunk(37, 37).resolution, 'procedural');
  } finally {
    await server.close();
  }
});

test('near-airport Arctic pilot contains the exact current natural batches', async () => {
  const pilot = await readDescriptor(WORLDCLAW_ROLLOUT_TARGETS[0]);
  assert.equal(pilot.runtimeRecord.heightSamples.length, 1681);
  assert.deepEqual(
    Object.fromEntries(pilot.prototypeBatches.map((batch) => [
      batch.assetId,
      batch.transforms.length,
    ])),
    {
      'proto-biome-crystal': 58,
      'proto-biome-rock': 38,
      'proto-biome-snow': 62,
      'proto-biome-water': 24,
    },
  );
});

test('compiled records are individually disableable and invalid composition falls back', async () => {
  const pilot = await readDescriptor(WORLDCLAW_ROLLOUT_TARGETS[0]);
  const { server, sourceModule } = await loadRuntimeModules();
  try {
    const fallback = sourceModule.createProceduralWorldChunkSource({
      seed: WORLDCLAW_DEFAULT_SEED,
    });
    const disabled = sourceModule.createValidatedWorldChunkSource({ fallback });
    assert.equal(disabled.resolveChunk(0, 1).resolution, 'procedural');

    const invalid = sourceModule.createValidatedWorldChunkSource({
      fallback,
      authoredChunks: [pilot.runtimeRecord],
      authoredPrototypeBatchesByChunk: {
        '0:1': [{ assetId: 'unknown-prototype', transforms: [] }],
      },
    });
    const rejected = invalid.resolveChunk(0, 1);
    assert.equal(rejected.resolution, 'procedural-fallback');
    assert.match(rejected.fallbackReason, /validation/i);
  } finally {
    await server.close();
  }
});
