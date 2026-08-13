import {
  BIOME_CATALOG,
  hashChunkCoordinates,
  selectBiomeForChunk,
  type BiomeDefinition,
  type BiomeId,
} from './BiomeCatalog';
import {
  BIOME_PROP_FAMILY_BY_ASSET_ID,
  type BiomePropFamily,
} from './BiomeWorldArt';
import {
  COMPILED_AUTHORED_WORLD_CHUNK_RECORDS,
  COMPILED_PROTOTYPE_BATCHES_BY_CHUNK,
} from './generated/CompiledWorldManifest.generated';

export const WORLD_CHUNK_SCHEMA_VERSION = '1.0.0';
export const WORLD_CHUNK_SIZE = 1280;
export const WORLD_CHUNK_SEGMENTS = 40;
export const WORLD_CHUNK_SAMPLES_PER_SIDE = WORLD_CHUNK_SEGMENTS + 1;
export const WORLD_CHUNK_CELL_SIZE = WORLD_CHUNK_SIZE / WORLD_CHUNK_SEGMENTS;
export const WORLD_AIRPORT_RESERVE_HALF_EXTENT = 430;
export const WORLD_AIRPORT_TERRAIN_HEIGHT = -0.245;

const TERRAIN_TRANSITION_WIDTH = 300;
const AIRPORT_FLAT_HALF_EXTENT = 390;
const AIRPORT_BLEND_DISTANCE = 170;
const DEFAULT_DESCRIPTOR_CACHE_SIZE = 64;
const PROCEDURAL_GENERATOR_VERSION = 'procedural-runtime-v1';
const PROCEDURAL_DATA_REVISION = 'procedural';
const MAX_AUTHORED_INSTANCES_PER_FAMILY = 2304;
const MAX_AUTHORED_URBAN_BOX_INSTANCES = 384;
const MAX_AUTHORED_URBAN_ROOF_INSTANCES = 128;
const URBAN_BOX_ASSET_ID = 'existing-urban-box-pool';
const URBAN_ROOF_ASSET_ID = 'existing-urban-roof-pool';
const NORMALIZED_QUATERNION_TOLERANCE = 1e-5;
const EMPTY_PROTOTYPE_BATCHES = Object.freeze([]) as readonly WorldChunkPrototypeBatch[];
const EMPTY_COMPOSITION_HASH = hashWorldChunkComposition(EMPTY_PROTOTYPE_BATCHES);

type AxisBiomeBlend = {
  center: number;
  neighbor: number;
  neighborWeight: number;
};

export type WorldChunkResolution = 'procedural' | 'authored' | 'procedural-fallback';

export type WorldChunkTranslation = readonly [number, number, number];
export type WorldChunkQuaternionXyzw = readonly [number, number, number, number];
export type WorldChunkPositiveScale = readonly [number, number, number];
export type WorldChunkLinearRgb = readonly [number, number, number];

export type WorldChunkPrototypeTransform = Readonly<{
  translation: WorldChunkTranslation;
  rotation: WorldChunkQuaternionXyzw;
  scale: WorldChunkPositiveScale;
  colorLinearRgb: WorldChunkLinearRgb;
}>;

export type WorldChunkPrototypeBatch = Readonly<{
  assetId: string;
  transforms: readonly WorldChunkPrototypeTransform[];
}>;

export type WorldChunkPrototypeBatchesByChunk = Readonly<
  Record<string, readonly WorldChunkPrototypeBatch[]>
>;

export type WorldChunkDescriptor = Readonly<{
  schemaVersion: typeof WORLD_CHUNK_SCHEMA_VERSION;
  generatorVersion: string;
  dataRevision: string;
  worldSeed: number;
  chunkX: number;
  chunkZ: number;
  biome: BiomeDefinition;
  resolution: WorldChunkResolution;
  heightSamples: Float32Array;
  heightHash: string;
  contentHash: string;
  prototypeBatches: readonly WorldChunkPrototypeBatch[];
  compositionHash: string;
  fallbackReason?: string;
}>;

export type AuthoredWorldChunkRecord = Readonly<{
  schemaVersion: string;
  generatorVersion: string;
  dataRevision: string;
  worldSeed: number;
  chunkX: number;
  chunkZ: number;
  biomeId: string;
  heightSamples: readonly number[] | Float32Array;
  heightHash: string;
  contentHash: string;
}>;

export type WorldChunkHashInput = Readonly<{
  schemaVersion: string;
  generatorVersion: string;
  dataRevision: string;
  worldSeed: number;
  chunkX: number;
  chunkZ: number;
  biomeId: string;
  heightHash: string;
}>;

export interface WorldChunkSource {
  readonly seed: number;
  readonly sourceHash: string;
  resolveChunk(chunkX: number, chunkZ: number): WorldChunkDescriptor;
  getBiomeForChunk(chunkX: number, chunkZ: number): BiomeDefinition;
  sampleHeight(worldX: number, worldZ: number): number;
  sampleVertexHeight(worldX: number, worldZ: number): number;
  isReserved(worldX: number, worldZ: number): boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function smoothstep01(value: number): number {
  const clamped = clamp01(value);
  return clamped * clamped * (3 - 2 * clamped);
}

function lerp(first: number, second: number, amount: number): number {
  return (1 - amount) * first + amount * second;
}

function finiteWorldCoordinate(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function integerChunkCoordinate(value: number): number {
  return Number.isFinite(value) ? Math.trunc(value) : 0;
}

export function worldChunkCoordinate(value: number): number {
  const finiteValue = finiteWorldCoordinate(value);
  return Math.floor((finiteValue + WORLD_CHUNK_SIZE * 0.5) / WORLD_CHUNK_SIZE);
}

export function worldChunkKey(chunkX: number, chunkZ: number): string {
  return `${integerChunkCoordinate(chunkX)}:${integerChunkCoordinate(chunkZ)}`;
}

export function isInsideWorldAirportReserve(worldX: number, worldZ: number): boolean {
  if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) return false;
  return Math.max(Math.abs(worldX), Math.abs(worldZ)) < WORLD_AIRPORT_RESERVE_HALF_EXTENT;
}

function getProceduralBiome(chunkX: number, chunkZ: number, seed: number): BiomeDefinition {
  if (chunkX === 0 && chunkZ === 0) return BIOME_CATALOG[0];
  return selectBiomeForChunk(chunkX, chunkZ, seed);
}

function writeAxisBiomeBlend(worldValue: number, out: AxisBiomeBlend): void {
  const center = worldChunkCoordinate(worldValue);
  const halfSize = WORLD_CHUNK_SIZE * 0.5;
  const local = worldValue - center * WORLD_CHUNK_SIZE;
  out.center = center;
  out.neighbor = center;
  out.neighborWeight = 0;
  if (local < -halfSize + TERRAIN_TRANSITION_WIDTH) {
    const transition = smoothstep01(
      (local + halfSize) / TERRAIN_TRANSITION_WIDTH,
    );
    out.neighbor = center - 1;
    out.neighborWeight = (1 - transition) * 0.5;
  } else if (local > halfSize - TERRAIN_TRANSITION_WIDTH) {
    const transition = smoothstep01(
      (local - (halfSize - TERRAIN_TRANSITION_WIDTH))
        / TERRAIN_TRANSITION_WIDTH,
    );
    out.neighbor = center + 1;
    out.neighborWeight = transition * 0.5;
  }
}

function valueNoise2D(
  worldX: number,
  worldZ: number,
  scale: number,
  seed: number,
): number {
  const x = worldX / scale;
  const z = worldZ / scale;
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = smoothstep01(x - x0);
  const tz = smoothstep01(z - z0);
  const sample = (sampleX: number, sampleZ: number): number =>
    hashChunkCoordinates(sampleX, sampleZ, seed) / 0xffffffff * 2 - 1;
  const north = lerp(sample(x0, z0), sample(x0 + 1, z0), tx);
  const south = lerp(sample(x0, z0 + 1), sample(x0 + 1, z0 + 1), tx);
  return lerp(north, south, tz);
}

function fractalNoise2D(
  worldX: number,
  worldZ: number,
  scale: number,
  seed: number,
  octaves = 4,
): number {
  let amplitude = 0.56;
  let frequency = 1;
  let total = 0;
  let normalization = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    total += valueNoise2D(
      worldX,
      worldZ,
      scale / frequency,
      seed + octave * 0x1f123bb5,
    ) * amplitude;
    normalization += amplitude;
    amplitude *= 0.52;
    frequency *= 2.03;
  }
  return total / normalization;
}

function biomeNaturalHeight(
  biome: BiomeDefinition,
  worldX: number,
  worldZ: number,
  seed: number,
): number {
  const macro = fractalNoise2D(worldX, worldZ, 520, seed ^ 0x52b7d3f1, 4);
  const detail = fractalNoise2D(worldX, worldZ, 145, seed ^ 0x1873a91d, 3);
  const ridge = 1 - Math.abs(fractalNoise2D(
    worldX,
    worldZ,
    390,
    seed ^ 0x6a09e667,
    4,
  ));
  const broad = (macro + 1) * 0.5;

  switch (biome.id) {
    case 'sunlit-meadow':
      return -0.08 + broad * 5.8 + detail * 1.35;
    case 'sahara-dunes': {
      const duneWave = Math.abs(Math.sin(
        worldX * 0.018 + worldZ * 0.0065 + macro * 1.7,
      ));
      return 0.35 + duneWave * (5.4 + broad * 4.1) + detail * 0.9;
    }
    case 'alpine-peaks':
      return 2.2 + Math.pow(ridge, 2.35) * (33 + broad * 27) + detail * 4.2;
    case 'arctic-tundra':
      return 0.25 + Math.pow(ridge, 2.7) * 9.5 + broad * 2.4 + detail * 0.75;
    case 'volcanic-wastes':
      return 2.4 + Math.pow(ridge, 2.05) * (19 + broad * 13) + detail * 2.4;
    case 'emerald-marsh':
      return -0.42 + broad * 2.1 + detail * 0.52;
    case 'red-rock-canyon': {
      const terrace = Math.floor(clamp01(broad) * 5) / 4;
      return 1.8 + terrace * 27 + Math.pow(ridge, 3.1) * 8 + detail * 1.7;
    }
    case 'autumn-forest':
      return 0.8 + broad * 8.2 + detail * 1.35;
    case 'tropical-lagoon': {
      const island = smoothstep01((broad - 0.26) / 0.5);
      return -0.34 + island * 7.7 + detail * 0.8;
    }
    case 'crystal-salt-flats':
      return -0.28 + broad * 1.65 + detail * 0.22;
    case 'metropolitan-core':
      return 0.45 + broad * 0.9 + detail * 0.16;
    case 'azure-harbor':
      return -0.18 + broad * 0.52 + detail * 0.1;
    case 'ironworks-district':
      return 0.24 + broad * 1.15 + detail * 0.2;
    case 'sunstone-citadel':
      return 0.7 + broad * 1.8 + detail * 0.3;
  }
}

function proceduralVertexHeight(
  worldX: number,
  worldZ: number,
  seed: number,
  axisBlendX: AxisBiomeBlend,
  axisBlendZ: AxisBiomeBlend,
): number {
  writeAxisBiomeBlend(worldX, axisBlendX);
  writeAxisBiomeBlend(worldZ, axisBlendZ);
  const xNeighborWeight = axisBlendX.neighborWeight;
  const zNeighborWeight = axisBlendZ.neighborWeight;
  const xCenterWeight = 1 - xNeighborWeight;
  const zCenterWeight = 1 - zNeighborWeight;
  const weightedHeight = (
    chunkX: number,
    chunkZ: number,
    weight: number,
  ): number => biomeNaturalHeight(
    getProceduralBiome(chunkX, chunkZ, seed),
    worldX,
    worldZ,
    seed,
  ) * weight;
  const naturalHeight =
    weightedHeight(
      axisBlendX.center,
      axisBlendZ.center,
      xCenterWeight * zCenterWeight,
    )
    + weightedHeight(
      axisBlendX.neighbor,
      axisBlendZ.center,
      xNeighborWeight * zCenterWeight,
    )
    + weightedHeight(
      axisBlendX.center,
      axisBlendZ.neighbor,
      xCenterWeight * zNeighborWeight,
    )
    + weightedHeight(
      axisBlendX.neighbor,
      axisBlendZ.neighbor,
      xNeighborWeight * zNeighborWeight,
    );
  const airportDistance = Math.max(Math.abs(worldX), Math.abs(worldZ));
  const airportBlend = smoothstep01(
    (airportDistance - AIRPORT_FLAT_HALF_EXTENT) / AIRPORT_BLEND_DISTANCE,
  );
  return lerp(WORLD_AIRPORT_TERRAIN_HEIGHT, naturalHeight, airportBlend);
}

function createHashState(): { value: number } {
  return { value: 0x811c9dc5 };
}

function updateHashByte(state: { value: number }, byte: number): void {
  state.value ^= byte & 0xff;
  state.value = Math.imul(state.value, 0x01000193) >>> 0;
}

function updateHashText(state: { value: number }, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    updateHashByte(state, code);
    updateHashByte(state, code >>> 8);
  }
  updateHashByte(state, 0xff);
}

function finishHash(state: { value: number }): string {
  return `fnv1a32:${state.value.toString(16).padStart(8, '0')}`;
}

export function hashWorldChunkHeightSamples(samples: ArrayLike<number>): string {
  const state = createHashState();
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  for (let index = 0; index < samples.length; index += 1) {
    view.setFloat32(0, Math.fround(samples[index]), true);
    updateHashByte(state, view.getUint8(0));
    updateHashByte(state, view.getUint8(1));
    updateHashByte(state, view.getUint8(2));
    updateHashByte(state, view.getUint8(3));
  }
  return finishHash(state);
}

export function hashWorldChunkContent(input: WorldChunkHashInput): string {
  const state = createHashState();
  updateHashText(state, input.schemaVersion);
  updateHashText(state, input.generatorVersion);
  updateHashText(state, input.dataRevision);
  updateHashText(state, String(input.worldSeed >>> 0));
  updateHashText(state, String(input.chunkX));
  updateHashText(state, String(input.chunkZ));
  updateHashText(state, input.biomeId);
  updateHashText(state, input.heightHash);
  return finishHash(state);
}

function updateHashNumber(
  state: { value: number },
  view: DataView,
  value: number,
): void {
  view.setFloat64(0, value, true);
  for (let index = 0; index < 8; index += 1) {
    updateHashByte(state, view.getUint8(index));
  }
}

export function hashWorldChunkComposition(
  batches: readonly WorldChunkPrototypeBatch[],
): string {
  const state = createHashState();
  const numberBuffer = new ArrayBuffer(8);
  const numberView = new DataView(numberBuffer);
  updateHashText(state, WORLD_CHUNK_SCHEMA_VERSION);
  updateHashText(state, 'prototype-composition-v1');
  const orderedBatches = [...batches].sort((first, second) =>
    first.assetId.localeCompare(second.assetId));
  updateHashText(state, String(orderedBatches.length));
  orderedBatches.forEach((batch) => {
    updateHashText(state, batch.assetId);
    updateHashText(state, String(batch.transforms.length));
    batch.transforms.forEach((transform) => {
      transform.translation.forEach((value) => updateHashNumber(state, numberView, value));
      transform.rotation.forEach((value) => updateHashNumber(state, numberView, value));
      transform.scale.forEach((value) => updateHashNumber(state, numberView, value));
      transform.colorLinearRgb.forEach((value) => updateHashNumber(state, numberView, value));
    });
  });
  return finishHash(state);
}

function hashSource(parts: readonly string[]): string {
  const state = createHashState();
  parts.forEach((part) => updateHashText(state, part));
  return finishHash(state);
}

function biomeById(id: string): BiomeDefinition | undefined {
  return BIOME_CATALOG.find((biome) => biome.id === id);
}

export function sampleWorldChunkDescriptorHeight(
  descriptor: WorldChunkDescriptor,
  worldX: number,
  worldZ: number,
): number {
  const chunkMinX = descriptor.chunkX * WORLD_CHUNK_SIZE - WORLD_CHUNK_SIZE * 0.5;
  const chunkMinZ = descriptor.chunkZ * WORLD_CHUNK_SIZE - WORLD_CHUNK_SIZE * 0.5;
  const localX = clamp(worldX - chunkMinX, 0, WORLD_CHUNK_SIZE);
  const localZ = clamp(worldZ - chunkMinZ, 0, WORLD_CHUNK_SIZE);
  const cellX = Math.min(
    Math.floor(localX / WORLD_CHUNK_CELL_SIZE),
    WORLD_CHUNK_SEGMENTS - 1,
  );
  const cellZ = Math.min(
    Math.floor(localZ / WORLD_CHUNK_CELL_SIZE),
    WORLD_CHUNK_SEGMENTS - 1,
  );
  const fractionX = clamp(
    (localX - cellX * WORLD_CHUNK_CELL_SIZE) / WORLD_CHUNK_CELL_SIZE,
    0,
    1,
  );
  const fractionZ = clamp(
    (localZ - cellZ * WORLD_CHUNK_CELL_SIZE) / WORLD_CHUNK_CELL_SIZE,
    0,
    1,
  );
  const index00 = cellZ * WORLD_CHUNK_SAMPLES_PER_SIDE + cellX;
  const height00 = descriptor.heightSamples[index00];
  const height10 = descriptor.heightSamples[index00 + 1];
  const height01 = descriptor.heightSamples[index00 + WORLD_CHUNK_SAMPLES_PER_SIDE];
  const height11 = descriptor.heightSamples[index00 + WORLD_CHUNK_SAMPLES_PER_SIDE + 1];

  if (fractionX + fractionZ <= 1) {
    return height00
      + (height10 - height00) * fractionX
      + (height01 - height00) * fractionZ;
  }
  return height11
    + (height01 - height11) * (1 - fractionX)
    + (height10 - height11) * (1 - fractionZ);
}

function setBoundedCache(
  cache: Map<string, WorldChunkDescriptor>,
  key: string,
  descriptor: WorldChunkDescriptor,
  maxEntries: number,
): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, descriptor);
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
}

function touchCachedDescriptor(
  cache: Map<string, WorldChunkDescriptor>,
  key: string,
): WorldChunkDescriptor | undefined {
  const descriptor = cache.get(key);
  if (!descriptor) return undefined;
  cache.delete(key);
  cache.set(key, descriptor);
  return descriptor;
}

export function createProceduralWorldChunkSource(options: {
  seed: number;
  maxCachedChunks?: number;
}): WorldChunkSource {
  const seed = options.seed >>> 0;
  const maxCachedChunks = Math.max(9, Math.trunc(
    options.maxCachedChunks ?? DEFAULT_DESCRIPTOR_CACHE_SIZE,
  ));
  const cache = new Map<string, WorldChunkDescriptor>();
  const axisBlendX: AxisBiomeBlend = { center: 0, neighbor: 0, neighborWeight: 0 };
  const axisBlendZ: AxisBiomeBlend = { center: 0, neighbor: 0, neighborWeight: 0 };
  const rawHeight = (worldX: number, worldZ: number): number => proceduralVertexHeight(
    finiteWorldCoordinate(worldX),
    finiteWorldCoordinate(worldZ),
    seed,
    axisBlendX,
    axisBlendZ,
  );

  const resolveChunk = (requestedX: number, requestedZ: number): WorldChunkDescriptor => {
    const chunkX = integerChunkCoordinate(requestedX);
    const chunkZ = integerChunkCoordinate(requestedZ);
    const key = worldChunkKey(chunkX, chunkZ);
    const cached = touchCachedDescriptor(cache, key);
    if (cached) return cached;

    const biome = getProceduralBiome(chunkX, chunkZ, seed);
    const heightSamples = new Float32Array(
      WORLD_CHUNK_SAMPLES_PER_SIDE * WORLD_CHUNK_SAMPLES_PER_SIDE,
    );
    const chunkMinX = chunkX * WORLD_CHUNK_SIZE - WORLD_CHUNK_SIZE * 0.5;
    const chunkMinZ = chunkZ * WORLD_CHUNK_SIZE - WORLD_CHUNK_SIZE * 0.5;
    for (let z = 0; z < WORLD_CHUNK_SAMPLES_PER_SIDE; z += 1) {
      const worldZ = chunkMinZ + z * WORLD_CHUNK_CELL_SIZE;
      for (let x = 0; x < WORLD_CHUNK_SAMPLES_PER_SIDE; x += 1) {
        const worldX = chunkMinX + x * WORLD_CHUNK_CELL_SIZE;
        heightSamples[z * WORLD_CHUNK_SAMPLES_PER_SIDE + x] = Math.fround(
          rawHeight(worldX, worldZ),
        );
      }
    }
    const heightHash = hashWorldChunkHeightSamples(heightSamples);
    const contentHash = hashWorldChunkContent({
      schemaVersion: WORLD_CHUNK_SCHEMA_VERSION,
      generatorVersion: PROCEDURAL_GENERATOR_VERSION,
      dataRevision: PROCEDURAL_DATA_REVISION,
      worldSeed: seed,
      chunkX,
      chunkZ,
      biomeId: biome.id,
      heightHash,
    });
    const descriptor: WorldChunkDescriptor = {
      schemaVersion: WORLD_CHUNK_SCHEMA_VERSION,
      generatorVersion: PROCEDURAL_GENERATOR_VERSION,
      dataRevision: PROCEDURAL_DATA_REVISION,
      worldSeed: seed,
      chunkX,
      chunkZ,
      biome,
      resolution: 'procedural',
      heightSamples,
      heightHash,
      contentHash,
      prototypeBatches: EMPTY_PROTOTYPE_BATCHES,
      compositionHash: EMPTY_COMPOSITION_HASH,
    };
    setBoundedCache(cache, key, descriptor, maxCachedChunks);
    return descriptor;
  };

  return {
    seed,
    sourceHash: hashSource([
      WORLD_CHUNK_SCHEMA_VERSION,
      PROCEDURAL_GENERATOR_VERSION,
      String(seed),
    ]),
    resolveChunk,
    getBiomeForChunk: (chunkX, chunkZ) =>
      getProceduralBiome(integerChunkCoordinate(chunkX), integerChunkCoordinate(chunkZ), seed),
    sampleHeight: (worldX, worldZ) => {
      const safeX = finiteWorldCoordinate(worldX);
      const safeZ = finiteWorldCoordinate(worldZ);
      return sampleWorldChunkDescriptorHeight(
        resolveChunk(worldChunkCoordinate(safeX), worldChunkCoordinate(safeZ)),
        safeX,
        safeZ,
      );
    },
    sampleVertexHeight: rawHeight,
    isReserved: isInsideWorldAirportReserve,
  };
}

type NormalizedAuthoredChunk = WorldChunkDescriptor & Readonly<{ biome: BiomeDefinition }>;

function normalizeAuthoredRecord(
  record: AuthoredWorldChunkRecord,
  fallback: WorldChunkSource,
): NormalizedAuthoredChunk | undefined {
  if (record.schemaVersion !== WORLD_CHUNK_SCHEMA_VERSION) return undefined;
  if (!record.generatorVersion || !record.dataRevision) return undefined;
  if (!Number.isInteger(record.chunkX) || !Number.isInteger(record.chunkZ)) return undefined;
  if (!Number.isInteger(record.worldSeed) || (record.worldSeed >>> 0) !== fallback.seed) {
    return undefined;
  }
  const biome = biomeById(record.biomeId);
  if (!biome) return undefined;
  const expectedLength = WORLD_CHUNK_SAMPLES_PER_SIDE * WORLD_CHUNK_SAMPLES_PER_SIDE;
  if (record.heightSamples.length !== expectedLength) return undefined;
  const heightSamples = new Float32Array(expectedLength);
  for (let index = 0; index < expectedLength; index += 1) {
    const value = record.heightSamples[index];
    if (!Number.isFinite(value)) return undefined;
    heightSamples[index] = Math.fround(value);
  }
  const heightHash = hashWorldChunkHeightSamples(heightSamples);
  if (heightHash !== record.heightHash) return undefined;
  const contentHash = hashWorldChunkContent({
    schemaVersion: record.schemaVersion,
    generatorVersion: record.generatorVersion,
    dataRevision: record.dataRevision,
    worldSeed: fallback.seed,
    chunkX: record.chunkX,
    chunkZ: record.chunkZ,
    biomeId: biome.id,
    heightHash,
  });
  if (contentHash !== record.contentHash) return undefined;
  return {
    schemaVersion: WORLD_CHUNK_SCHEMA_VERSION,
    generatorVersion: record.generatorVersion,
    dataRevision: record.dataRevision,
    worldSeed: fallback.seed,
    chunkX: record.chunkX,
    chunkZ: record.chunkZ,
    biome,
    resolution: 'authored',
    heightSamples,
    heightHash,
    contentHash,
    prototypeBatches: EMPTY_PROTOTYPE_BATCHES,
    compositionHash: EMPTY_COMPOSITION_HASH,
  };
}

function matchesOriginReservation(
  descriptor: NormalizedAuthoredChunk,
  fallback: WorldChunkSource,
): boolean {
  const minX = descriptor.chunkX * WORLD_CHUNK_SIZE - WORLD_CHUNK_SIZE * 0.5;
  const minZ = descriptor.chunkZ * WORLD_CHUNK_SIZE - WORLD_CHUNK_SIZE * 0.5;
  const fallbackDescriptor = fallback.resolveChunk(descriptor.chunkX, descriptor.chunkZ);
  for (let z = 0; z < WORLD_CHUNK_SAMPLES_PER_SIDE; z += 1) {
    const worldZ = minZ + z * WORLD_CHUNK_CELL_SIZE;
    for (let x = 0; x < WORLD_CHUNK_SAMPLES_PER_SIDE; x += 1) {
      const worldX = minX + x * WORLD_CHUNK_CELL_SIZE;
      if (!fallback.isReserved(worldX, worldZ)) continue;
      const index = z * WORLD_CHUNK_SAMPLES_PER_SIDE + x;
      if (!Object.is(descriptor.heightSamples[index], fallbackDescriptor.heightSamples[index])) {
        return false;
      }
    }
  }
  return true;
}

function edgeMatches(
  descriptor: WorldChunkDescriptor,
  neighbor: WorldChunkDescriptor,
  deltaX: number,
  deltaZ: number,
): boolean {
  for (let index = 0; index < WORLD_CHUNK_SAMPLES_PER_SIDE; index += 1) {
    let ownIndex: number;
    let neighborIndex: number;
    if (deltaX < 0) {
      ownIndex = index * WORLD_CHUNK_SAMPLES_PER_SIDE;
      neighborIndex = index * WORLD_CHUNK_SAMPLES_PER_SIDE + WORLD_CHUNK_SEGMENTS;
    } else if (deltaX > 0) {
      ownIndex = index * WORLD_CHUNK_SAMPLES_PER_SIDE + WORLD_CHUNK_SEGMENTS;
      neighborIndex = index * WORLD_CHUNK_SAMPLES_PER_SIDE;
    } else if (deltaZ < 0) {
      ownIndex = index;
      neighborIndex = WORLD_CHUNK_SEGMENTS * WORLD_CHUNK_SAMPLES_PER_SIDE + index;
    } else {
      ownIndex = WORLD_CHUNK_SEGMENTS * WORLD_CHUNK_SAMPLES_PER_SIDE + index;
      neighborIndex = index;
    }
    if (!Object.is(descriptor.heightSamples[ownIndex], neighbor.heightSamples[neighborIndex])) {
      return false;
    }
  }
  return true;
}

function hasExactObjectKeys(value: unknown, expectedKeys: readonly string[]): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  return actualKeys.length === sortedExpectedKeys.length
    && actualKeys.every((key, index) => key === sortedExpectedKeys[index]);
}

function isFiniteTuple(value: unknown, length: number): value is readonly number[] {
  return Array.isArray(value)
    && value.length === length
    && value.every((component) => Number.isFinite(component));
}

type WorldPrototypeCapacityPolicy = Readonly<{
  familyKey: BiomePropFamily | 'urbanBox' | 'urbanRoof';
  maximumInstances: number;
}>;

function prototypeCapacityPolicy(assetId: string): WorldPrototypeCapacityPolicy | undefined {
  if (Object.prototype.hasOwnProperty.call(BIOME_PROP_FAMILY_BY_ASSET_ID, assetId)) {
    return {
      familyKey: BIOME_PROP_FAMILY_BY_ASSET_ID[
        assetId as keyof typeof BIOME_PROP_FAMILY_BY_ASSET_ID
      ],
      maximumInstances: MAX_AUTHORED_INSTANCES_PER_FAMILY,
    };
  }
  if (assetId === URBAN_BOX_ASSET_ID) {
    return { familyKey: 'urbanBox', maximumInstances: MAX_AUTHORED_URBAN_BOX_INSTANCES };
  }
  if (assetId === URBAN_ROOF_ASSET_ID) {
    return { familyKey: 'urbanRoof', maximumInstances: MAX_AUTHORED_URBAN_ROOF_INSTANCES };
  }
  return undefined;
}

function normalizePrototypeBatches(
  input: readonly WorldChunkPrototypeBatch[],
  chunkX: number,
  chunkZ: number,
  fallback: WorldChunkSource,
): readonly WorldChunkPrototypeBatch[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const batchIds = new Set<string>();
  const familyCounts = new Map<WorldPrototypeCapacityPolicy['familyKey'], number>();
  const normalizedBatches: WorldChunkPrototypeBatch[] = [];

  for (const batch of input) {
    if (!hasExactObjectKeys(batch, ['assetId', 'transforms'])) return undefined;
    const assetId = batch.assetId;
    if (typeof assetId !== 'string') return undefined;
    const policy = prototypeCapacityPolicy(assetId);
    if (!policy) return undefined;
    if (batchIds.has(assetId) || !Array.isArray(batch.transforms)) return undefined;
    batchIds.add(assetId);
    const nextFamilyCount = (familyCounts.get(policy.familyKey) ?? 0)
      + batch.transforms.length;
    if (nextFamilyCount > policy.maximumInstances) return undefined;
    familyCounts.set(policy.familyKey, nextFamilyCount);

    const normalizedTransforms: WorldChunkPrototypeTransform[] = [];
    for (const transform of batch.transforms) {
      if (!hasExactObjectKeys(
        transform,
        ['translation', 'rotation', 'scale', 'colorLinearRgb'],
      )) {
        return undefined;
      }
      if (
        !isFiniteTuple(transform.translation, 3)
        || !isFiniteTuple(transform.rotation, 4)
        || !isFiniteTuple(transform.scale, 3)
        || !isFiniteTuple(transform.colorLinearRgb, 3)
      ) {
        return undefined;
      }
      const translation: WorldChunkTranslation = [
        transform.translation[0],
        transform.translation[1],
        transform.translation[2],
      ];
      const rotation: WorldChunkQuaternionXyzw = [
        transform.rotation[0],
        transform.rotation[1],
        transform.rotation[2],
        transform.rotation[3],
      ];
      const scale: WorldChunkPositiveScale = [
        transform.scale[0],
        transform.scale[1],
        transform.scale[2],
      ];
      const colorLinearRgb: WorldChunkLinearRgb = [
        transform.colorLinearRgb[0],
        transform.colorLinearRgb[1],
        transform.colorLinearRgb[2],
      ];
      if (
        translation[0] < -WORLD_CHUNK_SIZE * 0.5
        || translation[0] > WORLD_CHUNK_SIZE * 0.5
        || translation[2] < -WORLD_CHUNK_SIZE * 0.5
        || translation[2] > WORLD_CHUNK_SIZE * 0.5
      ) {
        return undefined;
      }
      const quaternionMagnitude = Math.hypot(...rotation);
      if (Math.abs(quaternionMagnitude - 1) > NORMALIZED_QUATERNION_TOLERANCE) {
        return undefined;
      }
      if (scale.some((component) => component <= 0)) return undefined;
      if (colorLinearRgb.some((component) => component < 0 || component > 1)) {
        return undefined;
      }
      const worldX = chunkX * WORLD_CHUNK_SIZE + translation[0];
      const worldZ = chunkZ * WORLD_CHUNK_SIZE + translation[2];
      if (fallback.isReserved(worldX, worldZ)) return undefined;

      normalizedTransforms.push(Object.freeze({
        translation: Object.freeze(translation),
        rotation: Object.freeze(rotation),
        scale: Object.freeze(scale),
        colorLinearRgb: Object.freeze(colorLinearRgb),
      }));
    }
    normalizedBatches.push(Object.freeze({
      assetId,
      transforms: Object.freeze(normalizedTransforms),
    }));
  }

  normalizedBatches.sort((first, second) => first.assetId.localeCompare(second.assetId));
  return Object.freeze(normalizedBatches);
}

function parseCanonicalWorldChunkKey(key: string): readonly [number, number] | undefined {
  const match = /^(-?(?:0|[1-9][0-9]*)):(-?(?:0|[1-9][0-9]*))$/.exec(key);
  if (!match) return undefined;
  const chunkX = Number(match[1]);
  const chunkZ = Number(match[2]);
  if (!Number.isSafeInteger(chunkX) || !Number.isSafeInteger(chunkZ)) return undefined;
  if (worldChunkKey(chunkX, chunkZ) !== key) return undefined;
  return [chunkX, chunkZ];
}

export function createValidatedWorldChunkSource(options: {
  fallback: WorldChunkSource;
  authoredChunks?: readonly AuthoredWorldChunkRecord[];
  authoredPrototypeBatchesByChunk?: WorldChunkPrototypeBatchesByChunk;
}): WorldChunkSource {
  const { fallback } = options;
  const records = options.authoredChunks ?? [];
  const duplicateKeys = new Set<string>();
  const recordKeys = new Set<string>();
  records.forEach((record) => {
    const key = worldChunkKey(record.chunkX, record.chunkZ);
    if (recordKeys.has(key)) duplicateKeys.add(key);
    recordKeys.add(key);
  });

  const invalidKeys = new Set<string>(duplicateKeys);
  const invalidFallbackDescriptors = new Map<string, WorldChunkDescriptor>();
  const validChunks = new Map<string, NormalizedAuthoredChunk>();
  records.forEach((record) => {
    const key = worldChunkKey(record.chunkX, record.chunkZ);
    if (duplicateKeys.has(key)) return;
    const normalized = normalizeAuthoredRecord(record, fallback);
    if (!normalized || !matchesOriginReservation(normalized, fallback)) {
      invalidKeys.add(key);
      return;
    }
    validChunks.set(key, normalized);
  });

  const compositionInputs = new Map<string, readonly WorldChunkPrototypeBatch[]>();
  Object.entries(options.authoredPrototypeBatchesByChunk ?? {}).forEach(([key, batches]) => {
    const coordinates = parseCanonicalWorldChunkKey(key);
    if (!coordinates) return;
    compositionInputs.set(worldChunkKey(coordinates[0], coordinates[1]), batches);
  });
  compositionInputs.forEach((batches, key) => {
    const descriptor = validChunks.get(key);
    if (!descriptor) {
      invalidKeys.add(key);
      return;
    }
    const normalizedBatches = normalizePrototypeBatches(
      batches,
      descriptor.chunkX,
      descriptor.chunkZ,
      fallback,
    );
    if (!normalizedBatches) {
      validChunks.delete(key);
      invalidKeys.add(key);
      return;
    }
    validChunks.set(key, {
      ...descriptor,
      prototypeBatches: normalizedBatches,
      compositionHash: hashWorldChunkComposition(normalizedBatches),
    });
  });

  const neighborOffsets = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ] as const;
  let removedInvalidEdge = true;
  while (removedInvalidEdge) {
    removedInvalidEdge = false;
    for (const [key, descriptor] of Array.from(validChunks.entries())) {
      const validEdges = neighborOffsets.every(([deltaX, deltaZ]) => {
        const neighborX = descriptor.chunkX + deltaX;
        const neighborZ = descriptor.chunkZ + deltaZ;
        const neighbor = validChunks.get(worldChunkKey(neighborX, neighborZ))
          ?? fallback.resolveChunk(neighborX, neighborZ);
        return edgeMatches(descriptor, neighbor, deltaX, deltaZ);
      });
      if (validEdges) continue;
      validChunks.delete(key);
      invalidKeys.add(key);
      removedInvalidEdge = true;
    }
  }

  const resolveChunk = (requestedX: number, requestedZ: number): WorldChunkDescriptor => {
    const chunkX = integerChunkCoordinate(requestedX);
    const chunkZ = integerChunkCoordinate(requestedZ);
    const key = worldChunkKey(chunkX, chunkZ);
    const authored = validChunks.get(key);
    if (authored) return authored;
    const procedural = fallback.resolveChunk(chunkX, chunkZ);
    if (!invalidKeys.has(key)) return procedural;
    const cachedFallback = invalidFallbackDescriptors.get(key);
    if (
      cachedFallback
      && cachedFallback.contentHash === procedural.contentHash
    ) {
      return cachedFallback;
    }
    const descriptor: WorldChunkDescriptor = {
      ...procedural,
      resolution: 'procedural-fallback',
      fallbackReason: 'authored chunk failed runtime validation',
    };
    invalidFallbackDescriptors.set(key, descriptor);
    return descriptor;
  };

  const sampleHeight = (worldX: number, worldZ: number): number => {
    const safeX = finiteWorldCoordinate(worldX);
    const safeZ = finiteWorldCoordinate(worldZ);
    return sampleWorldChunkDescriptorHeight(
      resolveChunk(worldChunkCoordinate(safeX), worldChunkCoordinate(safeZ)),
      safeX,
      safeZ,
    );
  };

  const acceptedContentHashes = Array.from(validChunks.values())
    .sort((first, second) =>
      worldChunkKey(first.chunkX, first.chunkZ).localeCompare(
        worldChunkKey(second.chunkX, second.chunkZ),
      ))
    .flatMap((descriptor) => [descriptor.contentHash, descriptor.compositionHash]);

  return {
    seed: fallback.seed,
    sourceHash: hashSource([fallback.sourceHash, ...acceptedContentHashes]),
    resolveChunk,
    getBiomeForChunk: (chunkX, chunkZ) => {
      const safeX = integerChunkCoordinate(chunkX);
      const safeZ = integerChunkCoordinate(chunkZ);
      return validChunks.get(worldChunkKey(safeX, safeZ))?.biome
        ?? fallback.getBiomeForChunk(safeX, safeZ);
    },
    sampleHeight,
    sampleVertexHeight: (worldX, worldZ) => {
      const safeX = finiteWorldCoordinate(worldX);
      const safeZ = finiteWorldCoordinate(worldZ);
      const chunkX = worldChunkCoordinate(safeX);
      const chunkZ = worldChunkCoordinate(safeZ);
      const authored = validChunks.get(worldChunkKey(chunkX, chunkZ));
      return authored
        ? sampleWorldChunkDescriptorHeight(authored, safeX, safeZ)
        : fallback.sampleVertexHeight(safeX, safeZ);
    },
    isReserved: fallback.isReserved,
  };
}

export function createDefaultWorldChunkSource(options: {
  seed: number;
  authoredChunks?: readonly AuthoredWorldChunkRecord[];
  authoredPrototypeBatchesByChunk?: WorldChunkPrototypeBatchesByChunk;
}): WorldChunkSource {
  const seed = options.seed >>> 0;
  const useCompiledWorld = seed === 0x071c0a57
    && options.authoredChunks === undefined
    && options.authoredPrototypeBatchesByChunk === undefined;
  const fallback = createProceduralWorldChunkSource({ seed });
  return createValidatedWorldChunkSource({
    fallback,
    authoredChunks: useCompiledWorld
      ? COMPILED_AUTHORED_WORLD_CHUNK_RECORDS
      : options.authoredChunks,
    authoredPrototypeBatchesByChunk: useCompiledWorld
      ? COMPILED_PROTOTYPE_BATCHES_BY_CHUNK
      : options.authoredPrototypeBatchesByChunk,
  });
}

export function createAuthoredWorldChunkRecord(input: Omit<
  AuthoredWorldChunkRecord,
  'schemaVersion' | 'heightHash' | 'contentHash'
>): AuthoredWorldChunkRecord {
  const heightSamples = Array.from(input.heightSamples, (value) => Math.fround(value));
  const heightHash = hashWorldChunkHeightSamples(heightSamples);
  const hashInput: WorldChunkHashInput = {
    schemaVersion: WORLD_CHUNK_SCHEMA_VERSION,
    generatorVersion: input.generatorVersion,
    dataRevision: input.dataRevision,
    worldSeed: input.worldSeed,
    chunkX: input.chunkX,
    chunkZ: input.chunkZ,
    biomeId: input.biomeId,
    heightHash,
  };
  return {
    ...input,
    schemaVersion: WORLD_CHUNK_SCHEMA_VERSION,
    heightSamples,
    heightHash,
    contentHash: hashWorldChunkContent(hashInput),
  };
}

export function isBiomeId(value: string): value is BiomeId {
  return biomeById(value) !== undefined;
}
