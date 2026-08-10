#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import {
  canonicalStringify,
  float32EdgeHash,
} from './worldclaw-compiler.mjs';

export const WORLDCLAW_DEFAULT_SEED = 0x071c0a57;

export const WORLDCLAW_PILOT_DESCRIPTOR_PATH =
  'data/world/pilots/chunk_0_1.json';

const WORLDCLAW_DESCRIPTOR_TEMPLATE_PATH =
  'data/world/regions/sunlit-meadow/chunk_-13_-5.json';

export const WORLDCLAW_ROLLOUT_TARGETS = Object.freeze([
  { chunkX: 0, chunkZ: 1, biomeId: 'arctic-tundra', pilot: true },
  { chunkX: -13, chunkZ: -5, biomeId: 'sunlit-meadow' },
  { chunkX: 1, chunkZ: 0, biomeId: 'arctic-tundra' },
  { chunkX: 1, chunkZ: 1, biomeId: 'arctic-tundra' },
  { chunkX: -1, chunkZ: 0, biomeId: 'volcanic-wastes' },
  { chunkX: -1, chunkZ: 1, biomeId: 'volcanic-wastes' },
  { chunkX: -1, chunkZ: -1, biomeId: 'red-rock-canyon' },
  { chunkX: 1, chunkZ: -1, biomeId: 'ironworks-district' },
  { chunkX: -11, chunkZ: -5, biomeId: 'azure-harbor' },
  { chunkX: -12, chunkZ: -4, biomeId: 'sunstone-citadel' },
  { chunkX: -11, chunkZ: 0, biomeId: 'crystal-salt-flats' },
  { chunkX: -13, chunkZ: -12, biomeId: 'sahara-dunes' },
  { chunkX: -8, chunkZ: -5, biomeId: 'emerald-marsh' },
  { chunkX: -8, chunkZ: -9, biomeId: 'autumn-forest' },
  { chunkX: -24, chunkZ: -7, biomeId: 'tropical-lagoon' },
  { chunkX: -17, chunkZ: -5, biomeId: 'alpine-peaks' },
  { chunkX: -21, chunkZ: -5, biomeId: 'metropolitan-core' },
]);

const EDGE_DEFINITIONS = [
  { edge: 'north', deltaX: 0, deltaZ: -1, neighborEdge: 'south' },
  { edge: 'east', deltaX: 1, deltaZ: 0, neighborEdge: 'west' },
  { edge: 'south', deltaX: 0, deltaZ: 1, neighborEdge: 'north' },
  { edge: 'west', deltaX: -1, deltaZ: 0, neighborEdge: 'east' },
];

function parseArguments(argv) {
  const options = { rootDir: process.cwd(), check: false, print: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--root') options.rootDir = path.resolve(argv[++index] ?? '');
    else if (argument === '--check') options.check = true;
    else if (argument === '--print') options.print = true;
    else if (argument === '--help') options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function usage() {
  return [
    'Usage: node scripts/worldclaw/export-runtime-chunks.mjs [options]',
    '',
    'Options:',
    '  --root <path>   Repository root (default: current directory)',
    '  --check         Verify checked descriptors without rewriting them',
    '  --print         Print the rollout summary',
    '  --help          Show this message',
  ].join('\n');
}

async function readJson(rootDir, repositoryPath) {
  return JSON.parse(await readFile(path.resolve(rootDir, repositoryPath), 'utf8'));
}

function coordinateToken(value) {
  if (value < 0) return `minus-${Math.abs(value)}`;
  if (value > 0) return `plus-${value}`;
  return 'zero';
}

function descriptorPath(target) {
  if (target.pilot) return WORLDCLAW_PILOT_DESCRIPTOR_PATH;
  return `data/world/regions/${target.biomeId}/chunk_${target.chunkX}_${target.chunkZ}.json`;
}

function descriptorId(target) {
  if (target.pilot) return 'pilot-chunk-near-airport-arctic-tundra';
  return [
    'worldclaw',
    target.biomeId,
    'chunk',
    coordinateToken(target.chunkX),
    coordinateToken(target.chunkZ),
  ].join('-');
}

function edgeSamples(samples, edge) {
  const side = 41;
  if (edge === 'north') return Array.from(samples.slice(0, side));
  if (edge === 'south') return Array.from(samples.slice((side - 1) * side));
  const x = edge === 'east' ? side - 1 : 0;
  return Array.from({ length: side }, (_, z) => samples[z * side + x]);
}

function runtimeIdentity(record) {
  return {
    schemaVersion: record.schemaVersion,
    generatorVersion: record.generatorVersion,
    dataRevision: record.dataRevision,
    worldSeed: record.worldSeed,
    chunkX: record.chunkX,
    chunkZ: record.chunkZ,
    biomeId: record.biomeId,
  };
}

function capacityForAsset(assetRegistry, assetId) {
  const asset = assetRegistry.assets.find((candidate) => candidate.id === assetId);
  if (!asset) throw new Error(`Unknown WorldClaw prototype asset: ${assetId}`);
  const capacity = asset.sharedActiveCapacity ?? asset.capacityPerChunkSlot;
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new Error(`Prototype asset has no usable capacity: ${assetId}`);
  }
  return capacity;
}

function buildDescriptor({
  baseDescriptor,
  target,
  repositoryPath,
  regionId,
  runtimeRecord,
  prototypeBatches,
  assetRegistry,
}) {
  const descriptor = structuredClone(baseDescriptor);
  const centerX = target.chunkX * 1280;
  const centerZ = target.chunkZ * 1280;
  descriptor.descriptorId = descriptorId(target);
  descriptor.runtimeRecordStatus = 'ready';
  descriptor.runtimeRecordIdentity = runtimeIdentity(runtimeRecord);
  descriptor.runtimeRecord = runtimeRecord;
  descriptor.chunk = {
    id: `chunk:${target.chunkX}:${target.chunkZ}`,
    coordinates: [target.chunkX, target.chunkZ],
    center: [centerX, 0, centerZ],
    boundsXZ: {
      minimum: [centerX - 640, centerZ - 640],
      maximum: [centerX + 640, centerZ + 640],
    },
    sizeMeters: 1280,
  };
  descriptor.regionId = regionId;
  descriptor.terrain.mode = 'authored-float32-grid';
  descriptor.terrain.heightPayload = null;
  descriptor.terrain.sharedEdges = EDGE_DEFINITIONS.map((definition) => ({
    edge: definition.edge,
    neighborChunkId: `chunk:${target.chunkX + definition.deltaX}:${target.chunkZ + definition.deltaZ}`,
    neighborEdge: definition.neighborEdge,
    sampleCount: 41,
    validation: 'float32-bit-identical',
    payloadHash: float32EdgeHash(edgeSamples(runtimeRecord.heightSamples, definition.edge)),
  }));
  descriptor.prototypeBatches = prototypeBatches;
  descriptor.declaredAssetIds = [
    'existing-streamed-terrain',
    ...prototypeBatches.map((batch) => batch.assetId),
  ];
  descriptor.capacities = prototypeBatches.map((batch) => ({
    assetId: batch.assetId,
    maximumActiveInstances: capacityForAsset(assetRegistry, batch.assetId),
  }));
  descriptor.artifactPaths.descriptor = repositoryPath;
  return descriptor;
}

async function createRuntimeModules(rootDir) {
  const server = await createServer({
    root: rootDir,
    configFile: false,
    logLevel: 'silent',
    server: { middlewareMode: true },
  });
  try {
    const [sourceModule, worldModule, urbanModule] = await Promise.all([
      server.ssrLoadModule('/src/world/WorldChunkSource.ts'),
      server.ssrLoadModule('/src/world/InfiniteBiomeWorld.ts'),
      server.ssrLoadModule('/src/world/UrbanBiomeArt.ts'),
    ]);
    return { server, sourceModule, worldModule, urbanModule };
  } catch (error) {
    await server.close();
    throw error;
  }
}

export async function exportWorldClawRuntimeChunks({
  rootDir,
  check = false,
} = {}) {
  const resolvedRoot = path.resolve(rootDir ?? process.cwd());
  const baseDescriptor = await readJson(
    resolvedRoot,
    WORLDCLAW_DESCRIPTOR_TEMPLATE_PATH,
  );
  const [regionGraph, assetRegistry] = await Promise.all([
    readJson(resolvedRoot, 'data/world/region_graph.json'),
    readJson(resolvedRoot, 'data/world/asset_registry.json'),
  ]);
  const regionByBiome = new Map(
    regionGraph.regions
      .filter((region) => typeof region.runtimeBiomeId === 'string')
      .map((region) => [region.runtimeBiomeId, region.id]),
  );
  const { server, sourceModule, worldModule, urbanModule } = await createRuntimeModules(
    resolvedRoot,
  );
  const summaries = [];
  const drift = [];
  try {
    const proceduralSource = sourceModule.createProceduralWorldChunkSource({
      seed: WORLDCLAW_DEFAULT_SEED,
      maxCachedChunks: 64,
    });
    for (const target of WORLDCLAW_ROLLOUT_TARGETS) {
      const procedural = proceduralSource.resolveChunk(target.chunkX, target.chunkZ);
      if (procedural.biome.id !== target.biomeId) {
        throw new Error(
          `Selector mismatch at ${target.chunkX}:${target.chunkZ}: expected ${target.biomeId}, received ${procedural.biome.id}`,
        );
      }
      const regionId = regionByBiome.get(target.biomeId);
      if (!regionId) throw new Error(`Missing region graph entry for ${target.biomeId}`);
      const runtimeRecord = sourceModule.createAuthoredWorldChunkRecord({
        generatorVersion: baseDescriptor.runtimeRecordIdentity.generatorVersion,
        dataRevision: baseDescriptor.dataRevision,
        worldSeed: WORLDCLAW_DEFAULT_SEED,
        chunkX: target.chunkX,
        chunkZ: target.chunkZ,
        biomeId: target.biomeId,
        heightSamples: procedural.heightSamples,
      });
      const naturalBatches = worldModule.createProceduralNaturalPrototypeBatches({
        chunkX: target.chunkX,
        chunkZ: target.chunkZ,
        seed: WORLDCLAW_DEFAULT_SEED,
        source: proceduralSource,
      });
      const urbanBatches = urbanModule.createProceduralUrbanPrototypeBatches({
        biome: procedural.biome,
        chunkX: target.chunkX,
        chunkZ: target.chunkZ,
        chunkSize: 1280,
        seed: WORLDCLAW_DEFAULT_SEED,
        terrainHeight: (worldX, worldZ) =>
          sourceModule.sampleWorldChunkDescriptorHeight(procedural, worldX, worldZ),
        isReserved: (worldX, worldZ) => proceduralSource.isReserved(worldX, worldZ),
      });
      const batches = [...naturalBatches, ...urbanBatches]
        .sort((first, second) => first.assetId.localeCompare(second.assetId));
      const repositoryPath = descriptorPath(target);
      const descriptor = buildDescriptor({
        baseDescriptor,
        target,
        repositoryPath,
        regionId,
        runtimeRecord,
        prototypeBatches: batches,
        assetRegistry,
      });
      const serialized = canonicalStringify(descriptor, { pretty: true });
      const absolutePath = path.resolve(resolvedRoot, repositoryPath);
      if (check) {
        let existing = '';
        try {
          existing = await readFile(absolutePath, 'utf8');
        } catch {
          // Report the missing file as deterministic drift below.
        }
        if (existing !== serialized) drift.push(repositoryPath);
      } else {
        await mkdir(path.dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, serialized, 'utf8');
      }
      summaries.push({
        chunkKey: `${target.chunkX}:${target.chunkZ}`,
        biomeId: target.biomeId,
        descriptorPath: repositoryPath,
        heightHash: runtimeRecord.heightHash,
        contentHash: runtimeRecord.contentHash,
        prototypeCount: batches.reduce(
          (total, batch) => total + batch.transforms.length,
          0,
        ),
      });
    }
  } finally {
    await server.close();
  }
  if (drift.length > 0) {
    throw new Error(`WorldClaw runtime descriptor drift:\n- ${drift.join('\n- ')}`);
  }
  return summaries;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const summaries = await exportWorldClawRuntimeChunks(options);
  const templateCount = new Set(summaries.map((summary) => summary.biomeId)).size;
  const prototypeCount = summaries.reduce(
    (total, summary) => total + summary.prototypeCount,
    0,
  );
  process.stdout.write(
    `WorldClaw runtime chunks ${options.check ? 'verified' : 'exported'}: ${summaries.length} descriptors, ${templateCount} biome templates, ${prototypeCount} prototype instances.\n`,
  );
  if (options.print) process.stdout.write(canonicalStringify(summaries, { pretty: true }));
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
