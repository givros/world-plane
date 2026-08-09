import * as THREE from 'three';
import {
  BIOME_CATALOG,
  hashChunkCoordinates,
  selectBiomeForChunk,
  type BiomeDefinition,
  type BiomeId,
} from './BiomeCatalog';
import {
  BIOME_PROP_FAMILIES,
  createBiomeHorizonSystem,
  createBiomePropResources,
  type BiomePropAccumulators,
  type BiomePropFamily,
} from './BiomeWorldArt';
import {
  createUrbanBiomeResources,
  populateUrbanChunk,
  type UrbanChunkSlot,
} from './UrbanBiomeArt';

export const BIOME_CHUNK_SIZE = 1280;
export const BIOME_GRID_SIZE = 3;
export const BIOME_FOG_NEAR = 580;
export const BIOME_FOG_FAR = 1040;

const GRID_RADIUS = 1;
const SLOT_COUNT = BIOME_GRID_SIZE * BIOME_GRID_SIZE;
const TERRAIN_SEGMENTS = 40;
const TERRAIN_TRANSITION_WIDTH = 300;
const AIRPORT_RESERVE_HALF_EXTENT = 430;
const MAX_INSTANCES_PER_FAMILY = 2304;
const DEFAULT_WORLD_SEED = 0x71c0a57;
const TERRAIN_CELL_SIZE = BIOME_CHUNK_SIZE / TERRAIN_SEGMENTS;

type ChunkCoordinate = Readonly<{ x: number; z: number }>;

type PropFamily = BiomePropFamily;

type CachedPropInstance = {
  matrix: THREE.Matrix4;
  color: THREE.Color;
};

type PropInstanceBatch = {
  instances: CachedPropInstance[];
  count: number;
};

type PropInstanceBatches = Record<PropFamily, PropInstanceBatch>;

export type LoadedBiomeChunk = Readonly<{
  key: string;
  x: number;
  z: number;
  biomeId: BiomeId;
  biomeLabel: string;
}>;

export type InfiniteBiomeWorldDiagnostics = {
  chunkSize: number;
  gridSize: number;
  centerChunk: { x: number; z: number };
  loadedChunkCount: number;
  loadedChunkKeys: string[];
  loadedChunks: LoadedBiomeChunk[];
  activeBiomeIds: BiomeId[];
  catalog: Array<{ id: BiomeId; label: string; signature: string }>;
  slotsCreated: number;
  slotsReused: number;
  chunksEvicted: number;
  poolSize: number;
  revision: number;
  activeInstances: number;
  familyInstances: Record<PropFamily, number>;
  droppedInstances: number;
  instancedMeshes: number;
  terrainMeshes: number;
  terrainSegments: number;
  loadedWorldSize: number;
  horizonRadius: number;
  uniqueGeometries: number;
  uniqueMaterials: number;
  fog: { near: number; far: number };
  urban: {
    activeChunkCount: number;
    boxInstances: number;
    roofInstances: number;
    droppedInstances: number;
    chunks: Array<{
      key: string;
      biomeId: BiomeId;
      districtCount: number;
      visualRoles: readonly string[];
      landmarkId: string;
      boxCount: number;
      roofCount: number;
    }>;
  };
};

export type InfiniteBiomeWorld = {
  group: THREE.Group;
  update: (focusPosition: Readonly<THREE.Vector3>) => boolean;
  recenterNow: (focusPosition: Readonly<THREE.Vector3>) => boolean;
  setVisible: (visible: boolean) => void;
  getTerrainHeight: (worldX: number, worldZ: number) => number;
  getBiomeForChunk: (chunkX: number, chunkZ: number) => BiomeDefinition;
  readonly diagnostics: Readonly<InfiniteBiomeWorldDiagnostics>;
  dispose: () => void;
};

type ChunkSlot = {
  index: number;
  key: string;
  chunkX: number;
  chunkZ: number;
  biome: BiomeDefinition;
  terrain: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  propBatches: PropInstanceBatches;
  urban: UrbanChunkSlot;
};

type PropAccumulators = BiomePropAccumulators;

type Placement = Readonly<{
  x: number;
  z: number;
  groundY: number;
}>;

const COLOR_SCRATCH_A = new THREE.Color();
const COLOR_SCRATCH_B = new THREE.Color();
const COLOR_SCRATCH_C = new THREE.Color();
const POSITION_SCRATCH = new THREE.Vector3();
const SCALE_SCRATCH = new THREE.Vector3();
const QUATERNION_SCRATCH = new THREE.Quaternion();
const EULER_SCRATCH = new THREE.Euler();
const NORMAL_SCRATCH = new THREE.Vector3();
const AXIS_BLEND_X = { center: 0, neighbor: 0, neighborWeight: 0 };
const AXIS_BLEND_Z = { center: 0, neighbor: 0, neighborWeight: 0 };

function clamp01(value: number): number {
  return THREE.MathUtils.clamp(value, 0, 1);
}

function smoothstep01(value: number): number {
  const clamped = clamp01(value);
  return clamped * clamped * (3 - 2 * clamped);
}

function chunkCoordinate(value: number): number {
  return Math.floor((value + BIOME_CHUNK_SIZE * 0.5) / BIOME_CHUNK_SIZE);
}

function chunkKey(chunkX: number, chunkZ: number): string {
  return String(chunkX) + ':' + String(chunkZ);
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
  };
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
  const north = THREE.MathUtils.lerp(sample(x0, z0), sample(x0 + 1, z0), tx);
  const south = THREE.MathUtils.lerp(sample(x0, z0 + 1), sample(x0 + 1, z0 + 1), tx);
  return THREE.MathUtils.lerp(north, south, tz);
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

function worldTerrainHeight(worldX: number, worldZ: number, seed: number): number {
  writeAxisBiomeBlend(worldX, AXIS_BLEND_X);
  writeAxisBiomeBlend(worldZ, AXIS_BLEND_Z);
  const xNeighborWeight = AXIS_BLEND_X.neighborWeight;
  const zNeighborWeight = AXIS_BLEND_Z.neighborWeight;
  const xCenterWeight = 1 - xNeighborWeight;
  const zCenterWeight = 1 - zNeighborWeight;
  const weightedHeight = (
    chunkX: number,
    chunkZ: number,
    weight: number,
  ): number => biomeNaturalHeight(
    getBiomeDefinition(chunkX, chunkZ, seed),
    worldX,
    worldZ,
    seed,
  ) * weight;
  const naturalHeight =
    weightedHeight(
      AXIS_BLEND_X.center,
      AXIS_BLEND_Z.center,
      xCenterWeight * zCenterWeight,
    )
    + weightedHeight(
      AXIS_BLEND_X.neighbor,
      AXIS_BLEND_Z.center,
      xNeighborWeight * zCenterWeight,
    )
    + weightedHeight(
      AXIS_BLEND_X.center,
      AXIS_BLEND_Z.neighbor,
      xCenterWeight * zNeighborWeight,
    )
    + weightedHeight(
      AXIS_BLEND_X.neighbor,
      AXIS_BLEND_Z.neighbor,
      xNeighborWeight * zNeighborWeight,
    );
  const airportDistance = Math.max(Math.abs(worldX), Math.abs(worldZ));
  const airportBlend = smoothstep01((airportDistance - 390) / 170);
  return THREE.MathUtils.lerp(-0.245, naturalHeight, airportBlend);
}

function sampledTerrainHeight(worldX: number, worldZ: number, seed: number): number {
  const chunkX = chunkCoordinate(worldX);
  const chunkZ = chunkCoordinate(worldZ);
  const cellSize = TERRAIN_CELL_SIZE;
  const chunkMinX = chunkX * BIOME_CHUNK_SIZE - BIOME_CHUNK_SIZE * 0.5;
  const chunkMinZ = chunkZ * BIOME_CHUNK_SIZE - BIOME_CHUNK_SIZE * 0.5;
  const localCellX = THREE.MathUtils.clamp(
    Math.floor((worldX - chunkMinX) / cellSize),
    0,
    TERRAIN_SEGMENTS - 1,
  );
  const localCellZ = THREE.MathUtils.clamp(
    Math.floor((worldZ - chunkMinZ) / cellSize),
    0,
    TERRAIN_SEGMENTS - 1,
  );
  const vertexX0 = chunkMinX + localCellX * cellSize;
  const vertexZ0 = chunkMinZ + localCellZ * cellSize;
  const fractionX = THREE.MathUtils.clamp((worldX - vertexX0) / cellSize, 0, 1);
  const fractionZ = THREE.MathUtils.clamp((worldZ - vertexZ0) / cellSize, 0, 1);
  const height00 = Math.fround(worldTerrainHeight(vertexX0, vertexZ0, seed));
  const height10 = Math.fround(worldTerrainHeight(vertexX0 + cellSize, vertexZ0, seed));
  const height01 = Math.fround(worldTerrainHeight(vertexX0, vertexZ0 + cellSize, seed));
  const height11 = Math.fround(worldTerrainHeight(vertexX0 + cellSize, vertexZ0 + cellSize, seed));

  // PlaneGeometry splits every cell along the b→d diagonal. Matching that
  // triangle interpolation keeps wheel contact exactly on the rendered mesh.
  if (fractionX + fractionZ <= 1) {
    return height00
      + (height10 - height00) * fractionX
      + (height01 - height00) * fractionZ;
  }
  return height11
    + (height01 - height11) * (1 - fractionX)
    + (height10 - height11) * (1 - fractionZ);
}

function isInsideAirportReserve(worldX: number, worldZ: number): boolean {
  return Math.max(Math.abs(worldX), Math.abs(worldZ)) < AIRPORT_RESERVE_HALF_EXTENT;
}

function getBiomeDefinition(chunkX: number, chunkZ: number, seed: number): BiomeDefinition {
  if (chunkX === 0 && chunkZ === 0) return BIOME_CATALOG[0];
  return selectBiomeForChunk(chunkX, chunkZ, seed);
}

function createTerrainMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    name: 'streamed-biome-terrain-vertex-color',
    color: '#ffffff',
    vertexColors: true,
    roughness: 0.89,
    metalness: 0,
    fog: true,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.terrainSkyZenith = { value: new THREE.Color('#3f86c3') };
    shader.uniforms.terrainSkyUpper = { value: new THREE.Color('#82bfe3') };
    shader.uniforms.terrainSkyHorizon = { value: new THREE.Color('#c4d9df') };
    shader.uniforms.terrainSkyLower = { value: new THREE.Color('#e6d6ba') };
    shader.uniforms.terrainSkyHaze = { value: new THREE.Color('#c4d9df') };
    shader.uniforms.terrainSkySunHaze = { value: new THREE.Color('#f4c58e') };
    shader.uniforms.terrainSkySunDirection = {
      value: new THREE.Vector3(-0.48, 0.58, -0.65).normalize(),
    };
    shader.vertexShader = shader.vertexShader
      .replace(
        'void main() {',
        `varying vec3 vTerrainWorldPosition;
         varying vec3 vTerrainWorldNormal;
         void main() {`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
         vTerrainWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vTerrainWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `varying vec3 vTerrainWorldPosition;
         varying vec3 vTerrainWorldNormal;
         uniform vec3 terrainSkyZenith;
         uniform vec3 terrainSkyUpper;
         uniform vec3 terrainSkyHorizon;
         uniform vec3 terrainSkyLower;
         uniform vec3 terrainSkyHaze;
         uniform vec3 terrainSkySunHaze;
         uniform vec3 terrainSkySunDirection;
         float terrainHash(vec2 point) {
           point = fract(point * vec2(123.34, 456.21));
           point += dot(point, point + 45.32);
           return fract(point.x * point.y);
         }
         float terrainNoise(vec2 point) {
           vec2 cell = floor(point);
           vec2 local = fract(point);
           local = local * local * (3.0 - 2.0 * local);
           return mix(
             mix(terrainHash(cell), terrainHash(cell + vec2(1.0, 0.0)), local.x),
             mix(terrainHash(cell + vec2(0.0, 1.0)), terrainHash(cell + 1.0), local.x),
             local.y
           );
         }
         float terrainFbm(vec2 point) {
           float value = 0.0;
           float amplitude = 0.56;
           mat2 rotation = mat2(0.80, -0.60, 0.60, 0.80);
           for (int octave = 0; octave < 4; octave++) {
             value += terrainNoise(point) * amplitude;
             point = rotation * point * 2.03 + 17.1;
             amplitude *= 0.5;
           }
           return value;
         }
         void main() {`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         vec2 terrainPoint = vTerrainWorldPosition.xz;
         float terrainMacro = terrainFbm(terrainPoint * 0.0048);
         float terrainMedium = terrainFbm(terrainPoint * 0.021 + 31.7);
         float terrainFine = terrainNoise(terrainPoint * 0.12 - 9.4);
         float terrainSlope = 1.0 - clamp(vTerrainWorldNormal.y, 0.0, 1.0);
         float terrainLuma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
         float greenMask = smoothstep(
           0.018,
           0.13,
           diffuseColor.g - max(diffuseColor.r, diffuseColor.b)
         );
         float warmMask = smoothstep(0.025, 0.30, diffuseColor.r - diffuseColor.b)
           * (1.0 - greenMask);
         float paleMask = smoothstep(0.38, 0.72, terrainLuma);
         float darkMask = 1.0 - smoothstep(0.045, 0.16, terrainLuma);

         float naturalVariation = mix(0.62, 1.38, terrainMacro)
           * mix(0.82, 1.18, terrainMedium)
           * mix(0.94, 1.06, terrainFine);
         diffuseColor.rgb *= naturalVariation;

         float meadowMottle = smoothstep(0.47, 0.73, terrainMedium)
           * smoothstep(0.18, 0.72, terrainMacro);
         diffuseColor.rgb = mix(
           diffuseColor.rgb,
           diffuseColor.rgb * vec3(0.72, 1.12, 0.68),
           meadowMottle * greenMask * 0.58
         );

         float windRipple = 0.5 + 0.5 * sin(
           terrainPoint.x * 0.085 + terrainPoint.y * 0.026
           + terrainNoise(terrainPoint * 0.012) * 6.0
         );
         diffuseColor.rgb = mix(
           diffuseColor.rgb,
           diffuseColor.rgb * vec3(1.20, 0.93, 0.72),
           windRipple * warmMask * 0.42
         );

         float mineralCrust = smoothstep(
           0.76,
           0.97,
           abs(sin(terrainPoint.x * 0.052 + terrainNoise(terrainPoint * 0.017) * 2.4)
             * sin(terrainPoint.y * 0.047 - terrainNoise(terrainPoint.yx * 0.019) * 2.1))
         );
         diffuseColor.rgb = mix(
           diffuseColor.rgb,
           diffuseColor.rgb * vec3(0.48, 0.70, 0.78),
           mineralCrust * paleMask * 0.62
         );

         float lavaVein = smoothstep(
           0.965,
           0.995,
           terrainNoise(terrainPoint * 0.035 + vec2(terrainMacro * 3.0))
         );
         diffuseColor.rgb = mix(
           diffuseColor.rgb,
           vec3(0.92, 0.12, 0.018),
           lavaVein * darkMask * 0.42
         );

         float contour = smoothstep(
           0.74,
           0.98,
           0.5 + 0.5 * sin(vTerrainWorldPosition.y * 0.42 + terrainMacro * 3.5)
         );
         diffuseColor.rgb = mix(
           diffuseColor.rgb,
           diffuseColor.rgb * vec3(0.54, 0.60, 0.63),
           smoothstep(0.08, 0.48, terrainSlope) * (0.42 + contour * 0.18)
         );`,
      )
      .replace(
        '#include <fog_fragment>',
        `float terrainFogFactor = smoothstep(fogNear, fogFar, vFogDepth);
         vec3 terrainSkyDirection = normalize(vTerrainWorldPosition - cameraPosition);
         float terrainSkyHeight = terrainSkyDirection.y;
         float terrainSkyUpperBlend = smoothstep(0.34, 0.88, terrainSkyHeight);
         float terrainSkyHorizonBlend = smoothstep(-0.18, 0.055, terrainSkyHeight);
         float terrainSkyAerialBand = exp(-pow((terrainSkyHeight - 0.012) * 8.5, 2.0));
         vec3 terrainSkyColor = mix(
           terrainSkyLower,
           terrainSkyHorizon,
           terrainSkyHorizonBlend
         );
         terrainSkyColor = mix(
           terrainSkyColor,
           terrainSkyUpper,
           smoothstep(0.16, 0.56, terrainSkyHeight)
         );
         terrainSkyColor = mix(
           terrainSkyColor,
           terrainSkyZenith,
           terrainSkyUpperBlend
         );
         terrainSkyColor = mix(
           terrainSkyColor,
           terrainSkyHaze,
           terrainSkyAerialBand * 0.34
         );
         float terrainSkySunAmount = max(
           dot(terrainSkyDirection, normalize(terrainSkySunDirection)),
           0.0
         );
         float terrainSkyHorizonScatter = pow(terrainSkySunAmount, 5.0)
           * terrainSkyAerialBand * 0.22;
         float terrainSkyHalo = pow(terrainSkySunAmount, 18.0) * 0.20;
         float terrainSkyDisc = pow(terrainSkySunAmount, 460.0) * 0.78;
         terrainSkyColor = mix(
           terrainSkyColor,
           terrainSkySunHaze,
           terrainSkyHorizonScatter
         );
         terrainSkyColor += vec3(1.0, 0.77, 0.43) * terrainSkyHalo
           + vec3(1.0, 0.93, 0.76) * terrainSkyDisc;
         gl_FragColor.rgb = mix(gl_FragColor.rgb, terrainSkyColor, terrainFogFactor);`,
      );
  };
  material.customProgramCacheKey = () => 'biome-terrain-world-detail-v4-directional-fog';
  return material;
}

function addInstance(
  batches: PropInstanceBatches,
  family: PropFamily,
  position: Readonly<THREE.Vector3>,
  scale: Readonly<THREE.Vector3>,
  color: THREE.ColorRepresentation,
  rotationX = 0,
  rotationY = 0,
  rotationZ = 0,
): void {
  const batch = batches[family];
  if (batch.count >= MAX_INSTANCES_PER_FAMILY) return;
  POSITION_SCRATCH.copy(position);
  SCALE_SCRATCH.copy(scale);
  EULER_SCRATCH.set(rotationX, rotationY, rotationZ);
  QUATERNION_SCRATCH.setFromEuler(EULER_SCRATCH);
  let instance = batch.instances[batch.count];
  if (!instance) {
    instance = {
      matrix: new THREE.Matrix4(),
      color: new THREE.Color(),
    };
    batch.instances.push(instance);
  }
  instance.matrix.compose(POSITION_SCRATCH, QUATERNION_SCRATCH, SCALE_SCRATCH);
  instance.color.set(color);
  batch.count += 1;
}

function createPropInstanceBatches(): PropInstanceBatches {
  const batches = {} as PropInstanceBatches;
  BIOME_PROP_FAMILIES.forEach((family) => {
    batches[family] = { instances: [], count: 0 };
  });
  return batches;
}

function resetPropInstanceBatches(batches: PropInstanceBatches): void {
  (Object.keys(batches) as PropFamily[]).forEach((family) => {
    batches[family].count = 0;
  });
}

function appendPropInstanceBatches(
  accumulators: PropAccumulators,
  batches: PropInstanceBatches,
): number {
  let dropped = 0;
  (Object.keys(batches) as PropFamily[]).forEach((family) => {
    const accumulator = accumulators[family];
    const batch = batches[family];
    const available = MAX_INSTANCES_PER_FAMILY - accumulator.count;
    const count = Math.min(batch.count, available);
    dropped += batch.count - count;
    for (let index = 0; index < count; index += 1) {
      const instance = batch.instances[index];
      accumulator.mesh.setMatrixAt(accumulator.count, instance.matrix);
      accumulator.mesh.setColorAt(accumulator.count, instance.color);
      accumulator.count += 1;
    }
  });
  return dropped;
}

function resetAccumulators(accumulators: PropAccumulators): void {
  (Object.keys(accumulators) as PropFamily[]).forEach((family) => {
    accumulators[family].count = 0;
    accumulators[family].mesh.count = 0;
  });
}

function commitAccumulators(accumulators: PropAccumulators): number {
  let total = 0;
  (Object.keys(accumulators) as PropFamily[]).forEach((family) => {
    const accumulator = accumulators[family];
    accumulator.mesh.count = accumulator.count;
    accumulator.mesh.instanceMatrix.needsUpdate = true;
    if (accumulator.mesh.instanceColor) accumulator.mesh.instanceColor.needsUpdate = true;
    total += accumulator.count;
  });
  return total;
}

function createChunkSlot(
  index: number,
  terrainMaterial: THREE.MeshStandardMaterial,
  urban: UrbanChunkSlot,
): ChunkSlot {
  const geometry = new THREE.PlaneGeometry(
    BIOME_CHUNK_SIZE,
    BIOME_CHUNK_SIZE,
    TERRAIN_SEGMENTS,
    TERRAIN_SEGMENTS,
  );
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  position.setUsage(THREE.DynamicDrawUsage);
  const colors = new THREE.Float32BufferAttribute(position.count * 3, 3);
  colors.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('color', colors);
  const terrain = new THREE.Mesh(geometry, terrainMaterial);
  terrain.name = 'streamed-biome-terrain-slot-' + String(index);
  terrain.receiveShadow = true;
  terrain.castShadow = false;
  terrain.frustumCulled = true;
  return {
    index,
    key: '',
    chunkX: 0,
    chunkZ: 0,
    biome: BIOME_CATALOG[0],
    terrain,
    propBatches: createPropInstanceBatches(),
    urban,
  };
}

function writeAxisBiomeBlend(
  worldValue: number,
  out: { center: number; neighbor: number; neighborWeight: number },
): void {
  const center = chunkCoordinate(worldValue);
  const halfSize = BIOME_CHUNK_SIZE * 0.5;
  const local = worldValue - center * BIOME_CHUNK_SIZE;
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

function addBiomeGroundColor(
  out: THREE.Color,
  biome: BiomeDefinition,
  weight: number,
): void {
  if (weight <= 0) return;
  COLOR_SCRATCH_B.set(biome.groundColor);
  out.r += COLOR_SCRATCH_B.r * weight;
  out.g += COLOR_SCRATCH_B.g * weight;
  out.b += COLOR_SCRATCH_B.b * weight;
}

function addBiomeRockColor(
  out: THREE.Color,
  biome: BiomeDefinition,
  weight: number,
): void {
  if (weight <= 0) return;
  COLOR_SCRATCH_B.set(biome.rockColor);
  out.r += COLOR_SCRATCH_B.r * weight;
  out.g += COLOR_SCRATCH_B.g * weight;
  out.b += COLOR_SCRATCH_B.b * weight;
}

function writeTerrainGroundColor(
  worldX: number,
  worldZ: number,
  seed: number,
  out: THREE.Color,
): void {
  writeAxisBiomeBlend(worldX, AXIS_BLEND_X);
  writeAxisBiomeBlend(worldZ, AXIS_BLEND_Z);
  const xNeighborWeight = AXIS_BLEND_X.neighborWeight;
  const zNeighborWeight = AXIS_BLEND_Z.neighborWeight;
  const xCenterWeight = 1 - xNeighborWeight;
  const zCenterWeight = 1 - zNeighborWeight;
  out.setRGB(0, 0, 0);
  addBiomeGroundColor(
    out,
    getBiomeDefinition(AXIS_BLEND_X.center, AXIS_BLEND_Z.center, seed),
    xCenterWeight * zCenterWeight,
  );
  addBiomeGroundColor(
    out,
    getBiomeDefinition(AXIS_BLEND_X.neighbor, AXIS_BLEND_Z.center, seed),
    xNeighborWeight * zCenterWeight,
  );
  addBiomeGroundColor(
    out,
    getBiomeDefinition(AXIS_BLEND_X.center, AXIS_BLEND_Z.neighbor, seed),
    xCenterWeight * zNeighborWeight,
  );
  addBiomeGroundColor(
    out,
    getBiomeDefinition(AXIS_BLEND_X.neighbor, AXIS_BLEND_Z.neighbor, seed),
    xNeighborWeight * zNeighborWeight,
  );
}

function writeTerrainRockColor(
  worldX: number,
  worldZ: number,
  seed: number,
  out: THREE.Color,
): void {
  writeAxisBiomeBlend(worldX, AXIS_BLEND_X);
  writeAxisBiomeBlend(worldZ, AXIS_BLEND_Z);
  const xNeighborWeight = AXIS_BLEND_X.neighborWeight;
  const zNeighborWeight = AXIS_BLEND_Z.neighborWeight;
  const xCenterWeight = 1 - xNeighborWeight;
  const zCenterWeight = 1 - zNeighborWeight;
  out.setRGB(0, 0, 0);
  addBiomeRockColor(
    out,
    getBiomeDefinition(AXIS_BLEND_X.center, AXIS_BLEND_Z.center, seed),
    xCenterWeight * zCenterWeight,
  );
  addBiomeRockColor(
    out,
    getBiomeDefinition(AXIS_BLEND_X.neighbor, AXIS_BLEND_Z.center, seed),
    xNeighborWeight * zCenterWeight,
  );
  addBiomeRockColor(
    out,
    getBiomeDefinition(AXIS_BLEND_X.center, AXIS_BLEND_Z.neighbor, seed),
    xCenterWeight * zNeighborWeight,
  );
  addBiomeRockColor(
    out,
    getBiomeDefinition(AXIS_BLEND_X.neighbor, AXIS_BLEND_Z.neighbor, seed),
    xNeighborWeight * zNeighborWeight,
  );
}

function writeTerrainNormal(
  worldX: number,
  worldZ: number,
  seed: number,
  out: THREE.Vector3,
): void {
  const step = TERRAIN_CELL_SIZE;
  const left = worldTerrainHeight(worldX - step, worldZ, seed);
  const right = worldTerrainHeight(worldX + step, worldZ, seed);
  const back = worldTerrainHeight(worldX, worldZ - step, seed);
  const front = worldTerrainHeight(worldX, worldZ + step, seed);
  out.set(left - right, step * 2, back - front).normalize();
}

function writeTerrainSlot(
  slot: ChunkSlot,
  chunkX: number,
  chunkZ: number,
  biome: BiomeDefinition,
  seed: number,
): void {
  slot.key = chunkKey(chunkX, chunkZ);
  slot.chunkX = chunkX;
  slot.chunkZ = chunkZ;
  slot.biome = biome;
  slot.terrain.position.set(
    chunkX * BIOME_CHUNK_SIZE,
    0,
    chunkZ * BIOME_CHUNK_SIZE,
  );
  slot.terrain.userData.chunkKey = slot.key;
  slot.terrain.userData.biomeId = biome.id;

  const geometry = slot.terrain.geometry;
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  const colors = geometry.getAttribute('color') as THREE.BufferAttribute;
  const normals = geometry.getAttribute('normal') as THREE.BufferAttribute;
  for (let index = 0; index < positions.count; index += 1) {
    const localX = positions.getX(index);
    const localZ = positions.getZ(index);
    const worldX = slot.terrain.position.x + localX;
    const worldZ = slot.terrain.position.z + localZ;
    const height = Math.fround(worldTerrainHeight(worldX, worldZ, seed));
    positions.setY(index, height);
    writeTerrainNormal(worldX, worldZ, seed, NORMAL_SCRATCH);
    normals.setXYZ(index, NORMAL_SCRATCH.x, NORMAL_SCRATCH.y, NORMAL_SCRATCH.z);
    writeTerrainGroundColor(worldX, worldZ, seed, COLOR_SCRATCH_A);
    writeTerrainRockColor(worldX, worldZ, seed, COLOR_SCRATCH_C);
    const slopeBlend = smoothstep01((1 - NORMAL_SCRATCH.y - 0.035) / 0.34) * 0.72;
    const macroVariation = 0.91
      + Math.sin(worldX * 0.021 + worldZ * 0.013) * 0.045
      + Math.sin(worldZ * 0.037 - worldX * 0.009) * 0.025;
    COLOR_SCRATCH_A.lerp(COLOR_SCRATCH_C, slopeBlend).multiplyScalar(macroVariation);
    colors.setXYZ(index, COLOR_SCRATCH_A.r, COLOR_SCRATCH_A.g, COLOR_SCRATCH_A.b);
  }
  positions.needsUpdate = true;
  colors.needsUpdate = true;
  normals.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

function sampleTerrainSlotHeight(
  slot: ChunkSlot,
  worldX: number,
  worldZ: number,
): number {
  const positions = slot.terrain.geometry.getAttribute('position') as THREE.BufferAttribute;
  const verticesPerSide = TERRAIN_SEGMENTS + 1;
  const chunkMinX = slot.chunkX * BIOME_CHUNK_SIZE - BIOME_CHUNK_SIZE * 0.5;
  const chunkMinZ = slot.chunkZ * BIOME_CHUNK_SIZE - BIOME_CHUNK_SIZE * 0.5;
  const localX = THREE.MathUtils.clamp(worldX - chunkMinX, 0, BIOME_CHUNK_SIZE);
  const localZ = THREE.MathUtils.clamp(worldZ - chunkMinZ, 0, BIOME_CHUNK_SIZE);
  const cellX = Math.min(Math.floor(localX / TERRAIN_CELL_SIZE), TERRAIN_SEGMENTS - 1);
  const cellZ = Math.min(Math.floor(localZ / TERRAIN_CELL_SIZE), TERRAIN_SEGMENTS - 1);
  const fractionX = THREE.MathUtils.clamp(
    (localX - cellX * TERRAIN_CELL_SIZE) / TERRAIN_CELL_SIZE,
    0,
    1,
  );
  const fractionZ = THREE.MathUtils.clamp(
    (localZ - cellZ * TERRAIN_CELL_SIZE) / TERRAIN_CELL_SIZE,
    0,
    1,
  );
  const index00 = cellZ * verticesPerSide + cellX;
  const height00 = positions.getY(index00);
  const height10 = positions.getY(index00 + 1);
  const height01 = positions.getY(index00 + verticesPerSide);
  const height11 = positions.getY(index00 + verticesPerSide + 1);
  if (fractionX + fractionZ <= 1) {
    return height00
      + (height10 - height00) * fractionX
      + (height01 - height00) * fractionZ;
  }
  return height11
    + (height01 - height11) * (1 - fractionX)
    + (height10 - height11) * (1 - fractionZ);
}

function randomPlacement(
  random: () => number,
  chunkX: number,
  chunkZ: number,
  seed: number,
  margin = 24,
): Placement | null {
  const usableSize = BIOME_CHUNK_SIZE - margin * 2;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const x = chunkX * BIOME_CHUNK_SIZE + (random() - 0.5) * usableSize;
    const z = chunkZ * BIOME_CHUNK_SIZE + (random() - 0.5) * usableSize;
    if (isInsideAirportReserve(x, z)) continue;
    return { x, z, groundY: sampledTerrainHeight(x, z, seed) };
  }
  return null;
}

function positionAt(
  placement: Placement,
  heightOffset: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  return out.set(placement.x, placement.groundY + heightOffset, placement.z);
}

function addTree(
  accumulators: PropInstanceBatches,
  placement: Placement,
  random: () => number,
  trunkColor: THREE.ColorRepresentation,
  crownColors: readonly THREE.ColorRepresentation[],
  autumn = false,
): void {
  const height = 7 + random() * 8;
  const width = 2.6 + random() * 2.8;
  const lean = (random() - 0.5) * 0.1;
  addInstance(
    accumulators,
    'trunk',
    positionAt(placement, height * 0.5, POSITION_SCRATCH),
    SCALE_SCRATCH.set(0.7 + random() * 0.35, height, 0.7 + random() * 0.35),
    trunkColor,
    lean,
    random() * Math.PI,
    lean * 0.6,
  );
  const crownColor = crownColors[Math.floor(random() * crownColors.length)];
  addInstance(
    accumulators,
    'canopy',
    positionAt(placement, height + width * 0.5, POSITION_SCRATCH),
    SCALE_SCRATCH.set(
      width * (0.9 + random() * 0.35),
      width * (autumn ? 0.82 : 0.68),
      width * (0.85 + random() * 0.28),
    ),
    crownColor,
    0,
    random() * Math.PI,
    0,
  );
}

function addConifer(
  accumulators: PropInstanceBatches,
  placement: Placement,
  random: () => number,
  color: THREE.ColorRepresentation,
  snowColor?: THREE.ColorRepresentation,
): void {
  const height = 10 + random() * 15;
  addInstance(
    accumulators,
    'trunk',
    positionAt(placement, height * 0.34, POSITION_SCRATCH),
    SCALE_SCRATCH.set(0.65, height * 0.68, 0.65),
    '#554638',
    0,
    random() * Math.PI,
    0,
  );
  addInstance(
    accumulators,
    'conifer',
    positionAt(placement, height * 0.06, POSITION_SCRATCH),
    SCALE_SCRATCH.set(4 + random() * 2.2, height, 4 + random() * 2.2),
    color,
    0,
    random() * Math.PI,
    0,
  );
  if (snowColor && random() > 0.38) {
    addInstance(
      accumulators,
      'snow',
      positionAt(placement, height * 0.93, POSITION_SCRATCH),
      SCALE_SCRATCH.set(3.1 + random(), 1.1 + random() * 0.8, 3.1 + random()),
      snowColor,
      0,
      random() * Math.PI,
      0,
    );
  }
}

function populateBiomeProps(
  accumulators: PropInstanceBatches,
  slot: ChunkSlot,
  seed: number,
): void {
  resetPropInstanceBatches(accumulators);
  const random = createRandom(
    hashChunkCoordinates(slot.chunkX, slot.chunkZ, seed ^ 0x5a31d2c7),
  );
  const biome = slot.biome;
  const clusterCenters: Placement[] = [];
  const chunkCenterX = slot.chunkX * BIOME_CHUNK_SIZE;
  const chunkCenterZ = slot.chunkZ * BIOME_CHUNK_SIZE;
  const signatureX = chunkCenterX + (random() - 0.5) * 170;
  const signatureZ = chunkCenterZ + (random() - 0.5) * 170;
  if (!isInsideAirportReserve(signatureX, signatureZ)) {
    clusterCenters.push({
      x: signatureX,
      z: signatureZ,
      groundY: sampledTerrainHeight(signatureX, signatureZ, seed),
    });
  }
  for (let index = 0; index < 8; index += 1) {
    const center = randomPlacement(random, slot.chunkX, slot.chunkZ, seed, 150);
    if (center) clusterCenters.push(center);
  }
  const makePlacement = (margin = 24): Placement | null => {
    if (clusterCenters.length > 0 && random() < 0.84) {
      const center = clusterCenters[Math.floor(random() * clusterCenters.length)];
      const angle = random() * Math.PI * 2;
      const radius = Math.pow(random(), 0.78) * (34 + random() * 102);
      const half = BIOME_CHUNK_SIZE * 0.5 - margin;
      const x = THREE.MathUtils.clamp(
        center.x + Math.cos(angle) * radius,
        chunkCenterX - half,
        chunkCenterX + half,
      );
      const z = THREE.MathUtils.clamp(
        center.z + Math.sin(angle) * radius,
        chunkCenterZ - half,
        chunkCenterZ + half,
      );
      if (!isInsideAirportReserve(x, z)) {
        return { x, z, groundY: sampledTerrainHeight(x, z, seed) };
      }
    }
    return randomPlacement(random, slot.chunkX, slot.chunkZ, seed, margin);
  };
  const addRepeated = (
    count: number,
    callback: (placement: Placement, index: number) => void,
    margin?: number,
  ): void => {
    for (let index = 0; index < count; index += 1) {
      const placement = makePlacement(margin);
      if (placement) callback(placement, index);
    }
  };
  const addGroundCover = (
    placement: Placement,
    color: THREE.ColorRepresentation,
    height = 1,
  ): void => {
    const width = 0.65 + random() * 0.85;
    addInstance(
      accumulators,
      'groundCover',
      positionAt(placement, 0.025, POSITION_SCRATCH),
      SCALE_SCRATCH.set(width, height * (0.7 + random() * 0.8), width),
      color,
      (random() - 0.5) * 0.08,
      random() * Math.PI,
      (random() - 0.5) * 0.08,
    );
  };
  const addRock = (
    placement: Placement,
    color: THREE.ColorRepresentation,
    size = 1.5 + random() * 3.5,
  ): void => {
    addInstance(
      accumulators,
      'rock',
      positionAt(placement, size * 0.42, POSITION_SCRATCH),
      SCALE_SCRATCH.set(size * (1.05 + random() * 0.55), size, size * (0.8 + random() * 0.35)),
      color,
      random() * 0.28,
      random() * Math.PI,
      random() * 0.24,
    );
  };
  const addMesa = (
    placement: Placement,
    color: THREE.ColorRepresentation,
    width: number,
    height: number,
    depth = width * (0.55 + random() * 0.25),
  ): void => {
    addInstance(
      accumulators,
      'mesa',
      positionAt(placement, 0, POSITION_SCRATCH),
      SCALE_SCRATCH.set(width, height, depth),
      color,
      0,
      random() * Math.PI,
      0,
    );
  };
  const addPalm = (placement: Placement): void => {
    const height = 10 + random() * 15;
    const lean = (random() - 0.5) * 0.2;
    addInstance(
      accumulators,
      'trunk',
      positionAt(placement, height * 0.5, POSITION_SCRATCH),
      SCALE_SCRATCH.set(0.62 + random() * 0.18, height, 0.62 + random() * 0.18),
      '#735237',
      lean,
      random() * Math.PI,
      lean * 0.55,
    );
    addInstance(
      accumulators,
      'frond',
      positionAt(placement, height + 0.5, POSITION_SCRATCH),
      SCALE_SCRATCH.set(4.8 + random() * 1.8, 2.6 + random(), 4.8 + random() * 1.8),
      random() > 0.4 ? biome.primaryColor : biome.secondaryColor,
      0,
      random() * Math.PI,
      0,
    );
  };
  const placementAtLocal = (localX: number, localZ: number): Placement | null => {
    const x = chunkCenterX + localX;
    const z = chunkCenterZ + localZ;
    if (isInsideAirportReserve(x, z)) return null;
    return { x, z, groundY: sampledTerrainHeight(x, z, seed) };
  };

  switch (biome.id) {
    case 'sunlit-meadow': {
      addRepeated(46, (placement) => {
        addTree(
          accumulators,
          placement,
          random,
          '#5b4934',
          [biome.primaryColor, biome.secondaryColor, '#6e9c43'],
        );
      });
      addRepeated(180, (placement) => {
        addGroundCover(
          placement,
          random() > 0.68 ? biome.accentColor : biome.secondaryColor,
          0.75,
        );
      });
      addRepeated(32, (placement) => addRock(
        placement,
        random() > 0.5 ? biome.rockColor : '#c2a76d',
        1.1 + random() * 2.2,
      ));
      addRepeated(12, (placement) => {
        addInstance(
          accumulators,
          'deadwood',
          positionAt(placement, 0, POSITION_SCRATCH),
          SCALE_SCRATCH.set(2.5, 5 + random() * 5, 2.5),
          '#58412f',
          0,
          random() * Math.PI,
          0,
        );
      });
      break;
    }

    case 'sahara-dunes': {
      addRepeated(34, (placement) => {
        addMesa(
          placement,
          random() > 0.48 ? biome.secondaryColor : biome.rockColor,
          8 + random() * 15,
          3 + random() * 8,
          5 + random() * 10,
        );
      }, 32);
      addRepeated(34, (placement) => {
        const height = 6 + random() * 10;
        addInstance(
          accumulators,
          'cactus',
          positionAt(placement, 0, POSITION_SCRATCH),
          SCALE_SCRATCH.set(2.2 + random(), height, 2.2 + random()),
          random() > 0.3 ? biome.primaryColor : '#527c48',
          0,
          random() * Math.PI,
          0,
        );
      });
      addRepeated(54, (placement) => addRock(
        placement,
        biome.rockColor,
        1.4 + random() * 3.8,
      ));
      addRepeated(70, (placement) => addGroundCover(
        placement,
        random() > 0.6 ? biome.accentColor : '#8f813e',
        0.55,
      ));
      break;
    }

    case 'alpine-peaks': {
      addRepeated(74, (placement) => {
        addConifer(
          accumulators,
          placement,
          random,
          biome.primaryColor,
          biome.secondaryColor,
        );
      });
      addRepeated(28, (placement) => {
        addMesa(
          placement,
          random() > 0.44 ? biome.rockColor : biome.secondaryColor,
          7 + random() * 9,
          18 + random() * 34,
        );
      }, 30);
      addRepeated(58, (placement) => addRock(placement, biome.rockColor));
      addRepeated(38, (placement) => {
        addInstance(
          accumulators,
          'snow',
          positionAt(placement, 0.06, POSITION_SCRATCH),
          SCALE_SCRATCH.set(5 + random() * 10, 1, 4 + random() * 8),
          biome.secondaryColor,
          0,
          random() * Math.PI,
          0,
        );
      });
      break;
    }

    case 'arctic-tundra': {
      addRepeated(62, (placement) => {
        addInstance(
          accumulators,
          'snow',
          positionAt(placement, 0.04, POSITION_SCRATCH),
          SCALE_SCRATCH.set(5 + random() * 11, 1, 3 + random() * 8),
          random() > 0.35 ? biome.secondaryColor : biome.groundColor,
          0,
          random() * Math.PI,
          0,
        );
      });
      addRepeated(58, (placement) => {
        const height = 5 + random() * 15;
        addInstance(
          accumulators,
          'crystal',
          positionAt(placement, 0, POSITION_SCRATCH),
          SCALE_SCRATCH.set(1.2 + random() * 2.4, height, 1.2 + random() * 2.4),
          random() > 0.5 ? biome.accentColor : '#dff6f5',
          0,
          random() * Math.PI,
          0,
        );
      });
      addRepeated(24, (placement) => {
        addInstance(
          accumulators,
          'water',
          positionAt(placement, 0.05, POSITION_SCRATCH),
          SCALE_SCRATCH.set(9 + random() * 15, 1, 6 + random() * 10),
          biome.waterColor,
          0,
          random() * Math.PI,
          0,
        );
      }, 30);
      addRepeated(38, (placement) => addRock(
        placement,
        biome.rockColor,
        1.2 + random() * 3.3,
      ));
      break;
    }

    case 'volcanic-wastes': {
      addRepeated(88, (placement) => addRock(
        placement,
        random() > 0.25 ? biome.rockColor : biome.secondaryColor,
        1.8 + random() * 5.4,
      ));
      addRepeated(38, (placement) => addMesa(
        placement,
        random() > 0.6 ? biome.primaryColor : biome.rockColor,
        3 + random() * 6,
        10 + random() * 26,
      ));
      addRepeated(38, (placement) => {
        addInstance(
          accumulators,
          'glow',
          positionAt(placement, 0.08, POSITION_SCRATCH),
          SCALE_SCRATCH.set(5 + random() * 12, 1, 3 + random() * 6),
          biome.accentColor,
          0,
          random() * Math.PI,
          0,
        );
      }, 24);
      addRepeated(24, (placement) => {
        addInstance(
          accumulators,
          'crystal',
          positionAt(placement, 0, POSITION_SCRATCH),
          SCALE_SCRATCH.set(1.4 + random() * 1.8, 5 + random() * 13, 1.4 + random() * 1.8),
          biome.accentColor,
          0,
          random() * Math.PI,
          0,
        );
      });
      break;
    }

    case 'emerald-marsh': {
      addRepeated(38, (placement) => {
        addInstance(
          accumulators,
          'water',
          positionAt(placement, 0.045, POSITION_SCRATCH),
          SCALE_SCRATCH.set(8 + random() * 16, 1, 6 + random() * 12),
          biome.waterColor,
          0,
          random() * Math.PI,
          0,
        );
      }, 28);
      addRepeated(190, (placement) => {
        addInstance(
          accumulators,
          'reed',
          positionAt(placement, 0, POSITION_SCRATCH),
          SCALE_SCRATCH.set(1.2 + random() * 0.8, 2.4 + random() * 4.2, 1.2 + random() * 0.8),
          random() > 0.45 ? biome.secondaryColor : biome.accentColor,
          0,
          random() * Math.PI,
          0,
        );
      });
      addRepeated(42, (placement) => {
        addInstance(
          accumulators,
          'deadwood',
          positionAt(placement, 0, POSITION_SCRATCH),
          SCALE_SCRATCH.set(2.6, 7 + random() * 11, 2.6),
          '#4b4637',
          0,
          random() * Math.PI,
          0,
        );
      });
      addRepeated(90, (placement) => addGroundCover(
        placement,
        random() > 0.5 ? biome.primaryColor : biome.secondaryColor,
        1.2,
      ));
      break;
    }

    case 'red-rock-canyon': {
      addRepeated(42, (placement) => {
        addMesa(
          placement,
          random() > 0.5 ? biome.primaryColor : biome.secondaryColor,
          8 + random() * 17,
          12 + random() * 31,
        );
      }, 32);
      addRepeated(34, (placement) => addMesa(
        placement,
        biome.rockColor,
        2.2 + random() * 4.2,
        13 + random() * 31,
        2.2 + random() * 4.2,
      ));
      addRepeated(58, (placement) => addRock(
        placement,
        random() > 0.5 ? biome.accentColor : biome.rockColor,
      ));
      addRepeated(20, (placement) => {
        const height = 5 + random() * 8;
        addInstance(
          accumulators,
          'cactus',
          positionAt(placement, 0, POSITION_SCRATCH),
          SCALE_SCRATCH.set(1.8, height, 1.8),
          '#567044',
          0,
          random() * Math.PI,
          0,
        );
      });
      break;
    }

    case 'autumn-forest': {
      addRepeated(88, (placement) => {
        addTree(
          accumulators,
          placement,
          random,
          '#4b3829',
          [biome.primaryColor, biome.secondaryColor, biome.accentColor, '#b94b28'],
          true,
        );
      });
      addRepeated(185, (placement) => addGroundCover(
        placement,
        [biome.primaryColor, biome.secondaryColor, biome.accentColor][Math.floor(random() * 3)],
        0.7,
      ));
      addRepeated(42, (placement) => addRock(
        placement,
        biome.rockColor,
        1.2 + random() * 2.9,
      ));
      addRepeated(22, (placement) => {
        addInstance(
          accumulators,
          'deadwood',
          positionAt(placement, 0, POSITION_SCRATCH),
          SCALE_SCRATCH.set(2.4, 5 + random() * 8, 2.4),
          '#4b3829',
          0,
          random() * Math.PI,
          0,
        );
      });
      break;
    }

    case 'tropical-lagoon': {
      addRepeated(38, (placement) => {
        addInstance(
          accumulators,
          'water',
          positionAt(placement, 0.05, POSITION_SCRATCH),
          SCALE_SCRATCH.set(9 + random() * 18, 1, 7 + random() * 14),
          biome.waterColor,
          0,
          random() * Math.PI,
          0,
        );
      }, 32);
      addRepeated(58, (placement) => addPalm(placement));
      addRepeated(44, (placement) => {
        addTree(
          accumulators,
          placement,
          random,
          '#5b4632',
          [biome.primaryColor, biome.secondaryColor, '#2f8f58'],
        );
      });
      addRepeated(155, (placement) => addGroundCover(
        placement,
        random() > 0.7 ? biome.accentColor : biome.secondaryColor,
        1.1,
      ));
      addRepeated(38, (placement) => addRock(
        placement,
        biome.rockColor,
        1.1 + random() * 3.2,
      ));
      break;
    }

    case 'crystal-salt-flats': {
      addRepeated(118, (placement) => {
        const height = 3 + random() * 15;
        addInstance(
          accumulators,
          'crystal',
          positionAt(placement, 0, POSITION_SCRATCH),
          SCALE_SCRATCH.set(0.7 + random() * 2.2, height, 0.7 + random() * 2.2),
          random() > 0.45 ? biome.accentColor : biome.secondaryColor,
          0,
          random() * Math.PI,
          0,
        );
      });
      addRepeated(58, (placement) => {
        addInstance(
          accumulators,
          'snow',
          positionAt(placement, 0.04, POSITION_SCRATCH),
          SCALE_SCRATCH.set(5 + random() * 12, 0.7, 4 + random() * 9),
          random() > 0.5 ? biome.groundColor : biome.secondaryColor,
          0,
          random() * Math.PI,
          0,
        );
      });
      addRepeated(28, (placement) => {
        addInstance(
          accumulators,
          'water',
          positionAt(placement, 0.05, POSITION_SCRATCH),
          SCALE_SCRATCH.set(7 + random() * 14, 1, 5 + random() * 11),
          biome.waterColor,
          0,
          random() * Math.PI,
          0,
        );
      }, 28);
      addRepeated(34, (placement) => addRock(
        placement,
        biome.rockColor,
        0.9 + random() * 2.4,
      ));
      break;
    }

    case 'metropolitan-core': {
      for (let index = 0; index < 24; index += 1) {
        const lane = index % 8;
        const side = Math.floor(index / 8) - 1;
        const placement = placementAtLocal(-560 + lane * 160, side * 320 + 66);
        if (!placement) continue;
        addTree(
          accumulators,
          placement,
          random,
          '#4c443b',
          ['#3b7653', '#4f8a5d', '#6b9a62'],
        );
      }
      for (let index = 0; index < 20; index += 1) {
        const placement = placementAtLocal(
          -560 + (index % 8) * 160,
          -560 + Math.floor(index / 8) * 320,
        );
        if (!placement) continue;
        addInstance(
          accumulators,
          'trunk',
          positionAt(placement, 4.2, POSITION_SCRATCH),
          SCALE_SCRATCH.set(0.22, 8.4, 0.22),
          '#3b4144',
        );
        addInstance(
          accumulators,
          'crystal',
          positionAt(placement, 8.2, POSITION_SCRATCH),
          SCALE_SCRATCH.set(0.42, 1.1, 0.42),
          biome.accentColor,
        );
      }
      break;
    }

    case 'azure-harbor': {
      for (let index = 0; index < 18; index += 1) {
        const placement = placementAtLocal(-560 + (index % 8) * 160, 530);
        if (placement) addPalm(placement);
      }
      for (let index = 0; index < 12; index += 1) {
        const placement = placementAtLocal(-520 + (index % 6) * 190, -500 + Math.floor(index / 6) * 160);
        if (!placement) continue;
        addInstance(
          accumulators,
          'deadwood',
          positionAt(placement, 0, POSITION_SCRATCH),
          SCALE_SCRATCH.set(4.2, 22 + random() * 10, 4.2),
          random() > 0.5 ? biome.accentColor : '#4d5658',
          0,
          index % 2 === 0 ? 0 : Math.PI * 0.5,
        );
      }
      break;
    }

    case 'ironworks-district': {
      for (let index = 0; index < 30; index += 1) {
        const column = index % 6;
        const row = Math.floor(index / 6);
        const placement = placementAtLocal(-480 + column * 160, -430 + row * 190);
        if (!placement) continue;
        const tankHeight = 8 + random() * 12;
        addInstance(
          accumulators,
          'trunk',
          positionAt(placement, tankHeight * 0.5, POSITION_SCRATCH),
          SCALE_SCRATCH.set(4.5 + random() * 3.5, tankHeight, 4.5 + random() * 3.5),
          random() > 0.35 ? '#777a72' : biome.secondaryColor,
        );
      }
      for (let index = 0; index < 12; index += 1) {
        const placement = placementAtLocal(360 + (index % 3) * 90, -470 + Math.floor(index / 3) * 280);
        if (!placement) continue;
        const stackHeight = 28 + random() * 35;
        addInstance(
          accumulators,
          'trunk',
          positionAt(placement, stackHeight * 0.5, POSITION_SCRATCH),
          SCALE_SCRATCH.set(1.8 + random(), stackHeight, 1.8 + random()),
          index % 2 === 0 ? '#4a4d4d' : '#8a654a',
        );
      }
      for (let index = 0; index < 6; index += 1) {
        const placement = placementAtLocal(430 + (index % 2) * 90, -360 + Math.floor(index / 2) * 300);
        if (!placement) continue;
        addMesa(placement, '#555a59', 12 + random() * 5, 18 + random() * 11, 12 + random() * 5);
      }
      break;
    }

    case 'sunstone-citadel': {
      for (let index = 0; index < 22; index += 1) {
        const angle = index / 22 * Math.PI * 2;
        const placement = placementAtLocal(Math.cos(angle) * 430, Math.sin(angle) * 430);
        if (placement) addPalm(placement);
      }
      for (let index = 0; index < 18; index += 1) {
        const placement = placementAtLocal(
          -400 + (index % 6) * 160,
          -350 + Math.floor(index / 6) * 310,
        );
        if (!placement) continue;
        addInstance(
          accumulators,
          'snow',
          positionAt(placement, 0, POSITION_SCRATCH),
          SCALE_SCRATCH.set(6 + random() * 4, 5 + random() * 3, 6 + random() * 4),
          index % 2 === 0 ? biome.secondaryColor : '#e1a86d',
        );
      }
      for (let index = 0; index < 8; index += 1) {
        const placement = placementAtLocal(-420 + index * 120, 80);
        if (!placement) continue;
        addInstance(
          accumulators,
          'crystal',
          positionAt(placement, 0, POSITION_SCRATCH),
          SCALE_SCRATCH.set(3.2, 18 + random() * 18, 3.2),
          index % 2 === 0 ? biome.primaryColor : biome.accentColor,
        );
      }
      break;
    }
  }
}

function desiredChunkCoordinates(centerX: number, centerZ: number): ChunkCoordinate[] {
  const coordinates: ChunkCoordinate[] = [];
  for (let z = centerZ - GRID_RADIUS; z <= centerZ + GRID_RADIUS; z += 1) {
    for (let x = centerX - GRID_RADIUS; x <= centerX + GRID_RADIUS; x += 1) {
      coordinates.push({ x, z });
    }
  }
  return coordinates;
}

export function createInfiniteBiomeWorld(options: { seed?: number } = {}): InfiniteBiomeWorld {
  const seed = options.seed ?? DEFAULT_WORLD_SEED;
  const group = new THREE.Group();
  group.name = 'infinite-streamed-biome-world';
  const terrainMaterial = createTerrainMaterial();
  const slots: ChunkSlot[] = [];
  const freeSlots: ChunkSlot[] = [];
  const activeSlots = new Map<string, ChunkSlot>();
  const urbanResources = createUrbanBiomeResources(group, SLOT_COUNT);
  for (let index = 0; index < SLOT_COUNT; index += 1) {
    const slot = createChunkSlot(index, terrainMaterial, urbanResources.slots[index]);
    slots.push(slot);
    freeSlots.push(slot);
    group.add(slot.terrain);
  }
  const propResources = createBiomePropResources(group, MAX_INSTANCES_PER_FAMILY);
  const horizon = createBiomeHorizonSystem();
  group.add(horizon.group);
  let disposed = false;

  const diagnostics: InfiniteBiomeWorldDiagnostics = {
    chunkSize: BIOME_CHUNK_SIZE,
    gridSize: BIOME_GRID_SIZE,
    centerChunk: { x: Number.NaN, z: Number.NaN },
    loadedChunkCount: 0,
    loadedChunkKeys: [],
    loadedChunks: [],
    activeBiomeIds: [],
    catalog: BIOME_CATALOG.map((biome) => ({
      id: biome.id,
      label: biome.label,
      signature: [
        biome.id,
        biome.groundColor,
        biome.primaryColor,
        biome.secondaryColor,
        biome.accentColor,
      ].join('|'),
    })),
    slotsCreated: SLOT_COUNT,
    slotsReused: 0,
    chunksEvicted: 0,
    poolSize: SLOT_COUNT,
    revision: 0,
    activeInstances: 0,
    familyInstances: Object.fromEntries(
      BIOME_PROP_FAMILIES.map((family) => [family, 0]),
    ) as Record<PropFamily, number>,
    droppedInstances: 0,
    instancedMeshes: Object.keys(propResources.accumulators).length
      + urbanResources.slots.length * 2,
    terrainMeshes: SLOT_COUNT,
    terrainSegments: TERRAIN_SEGMENTS,
    loadedWorldSize: BIOME_CHUNK_SIZE * BIOME_GRID_SIZE,
    horizonRadius: 1580,
    uniqueGeometries: SLOT_COUNT
      + propResources.geometries.length
      + urbanResources.geometries.length
      + horizon.geometries.length,
    uniqueMaterials: 1
      + propResources.materials.length
      + urbanResources.materials.length
      + horizon.materials.length,
    fog: { near: BIOME_FOG_NEAR, far: BIOME_FOG_FAR },
    urban: {
      activeChunkCount: 0,
      boxInstances: 0,
      roofInstances: 0,
      droppedInstances: 0,
      chunks: [],
    },
  };

  const rebuildProps = (): void => {
    resetAccumulators(propResources.accumulators);
    let droppedInstances = 0;
    const orderedSlots = Array.from(activeSlots.values()).sort((first, second) => {
      const firstDistance = Math.abs(first.chunkX - diagnostics.centerChunk.x)
        + Math.abs(first.chunkZ - diagnostics.centerChunk.z);
      const secondDistance = Math.abs(second.chunkX - diagnostics.centerChunk.x)
        + Math.abs(second.chunkZ - diagnostics.centerChunk.z);
      return firstDistance - secondDistance || first.key.localeCompare(second.key);
    });
    orderedSlots.forEach((slot) => {
      droppedInstances += appendPropInstanceBatches(
        propResources.accumulators,
        slot.propBatches,
      );
    });
    let urbanBoxes = 0;
    let urbanRoofs = 0;
    let urbanDropped = 0;
    orderedSlots.forEach((slot) => {
      urbanBoxes += slot.urban.stats.boxCount;
      urbanRoofs += slot.urban.stats.roofCount;
      urbanDropped += slot.urban.stats.droppedInstances;
    });
    diagnostics.urban.boxInstances = urbanBoxes;
    diagnostics.urban.roofInstances = urbanRoofs;
    diagnostics.urban.droppedInstances = urbanDropped;
    diagnostics.activeInstances = commitAccumulators(propResources.accumulators)
      + urbanBoxes
      + urbanRoofs;
    diagnostics.droppedInstances = droppedInstances + urbanDropped;
    BIOME_PROP_FAMILIES.forEach((family) => {
      diagnostics.familyInstances[family] = propResources.accumulators[family].count;
    });
  };

  const refreshDiagnostics = (): void => {
    const loadedChunks = Array.from(activeSlots.values())
      .map((slot): LoadedBiomeChunk => ({
        key: slot.key,
        x: slot.chunkX,
        z: slot.chunkZ,
        biomeId: slot.biome.id,
        biomeLabel: slot.biome.label,
      }))
      .sort((first, second) => first.key.localeCompare(second.key));
    diagnostics.loadedChunks = loadedChunks;
    diagnostics.loadedChunkKeys = loadedChunks.map((chunk) => chunk.key);
    diagnostics.loadedChunkCount = loadedChunks.length;
    diagnostics.activeBiomeIds = Array.from(
      new Set(loadedChunks.map((chunk) => chunk.biomeId)),
    );
    diagnostics.urban.chunks = Array.from(activeSlots.values())
      .filter((slot) => slot.urban.stats.districtCount > 0)
      .map((slot) => ({
        key: slot.key,
        biomeId: slot.biome.id,
        districtCount: slot.urban.stats.districtCount,
        visualRoles: slot.urban.stats.visualRoles,
        landmarkId: slot.urban.stats.landmarkId,
        boxCount: slot.urban.stats.boxCount,
        roofCount: slot.urban.stats.roofCount,
      }))
      .sort((first, second) => first.key.localeCompare(second.key));
    diagnostics.urban.activeChunkCount = diagnostics.urban.chunks.length;
    diagnostics.poolSize = freeSlots.length;
  };

  const streamTo = (focusPosition: Readonly<THREE.Vector3>): boolean => {
    if (disposed) return false;
    const centerX = chunkCoordinate(focusPosition.x);
    const centerZ = chunkCoordinate(focusPosition.z);
    horizon.update(focusPosition, getBiomeDefinition(centerX, centerZ, seed));
    if (
      diagnostics.centerChunk.x === centerX
      && diagnostics.centerChunk.z === centerZ
      && activeSlots.size === SLOT_COUNT
    ) {
      return false;
    }

    const desired = desiredChunkCoordinates(centerX, centerZ);
    const desiredKeys = new Set(desired.map((coordinate) =>
      chunkKey(coordinate.x, coordinate.z)));
    for (const [key, slot] of activeSlots) {
      if (desiredKeys.has(key)) continue;
      activeSlots.delete(key);
      freeSlots.push(slot);
      diagnostics.chunksEvicted += 1;
    }

    desired.forEach((coordinate) => {
      const key = chunkKey(coordinate.x, coordinate.z);
      if (activeSlots.has(key)) return;
      const slot = freeSlots.pop();
      if (!slot) throw new Error('Infinite biome slot pool exhausted.');
      const biome = getBiomeDefinition(coordinate.x, coordinate.z, seed);
      writeTerrainSlot(slot, coordinate.x, coordinate.z, biome, seed);
      populateBiomeProps(slot.propBatches, slot, seed);
      populateUrbanChunk(slot.urban, {
        biome,
        chunkX: coordinate.x,
        chunkZ: coordinate.z,
        chunkSize: BIOME_CHUNK_SIZE,
        seed,
        terrainHeight: (worldX, worldZ) => sampleTerrainSlotHeight(slot, worldX, worldZ),
        isReserved: isInsideAirportReserve,
      });
      activeSlots.set(key, slot);
      if (diagnostics.revision > 0) diagnostics.slotsReused += 1;
    });

    diagnostics.centerChunk.x = centerX;
    diagnostics.centerChunk.z = centerZ;
    diagnostics.revision += 1;
    rebuildProps();
    refreshDiagnostics();
    return true;
  };

  const api: InfiniteBiomeWorld = {
    group,
    update: streamTo,
    recenterNow: streamTo,
    setVisible: (visible) => {
      group.visible = visible;
    },
    getTerrainHeight: (worldX, worldZ) => sampledTerrainHeight(worldX, worldZ, seed),
    getBiomeForChunk: (chunkX, chunkZ) =>
      getBiomeDefinition(chunkX, chunkZ, seed),
    get diagnostics() {
      return diagnostics;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      group.removeFromParent();
      slots.forEach((slot) => slot.terrain.geometry.dispose());
      propResources.geometries.forEach((geometry) => geometry.dispose());
      urbanResources.geometries.forEach((geometry) => geometry.dispose());
      horizon.geometries.forEach((geometry) => geometry.dispose());
      terrainMaterial.dispose();
      propResources.materials.forEach((material) => material.dispose());
      urbanResources.materials.forEach((material) => material.dispose());
      horizon.materials.forEach((material) => material.dispose());
      diagnostics.loadedChunkCount = 0;
      diagnostics.loadedChunkKeys = [];
      diagnostics.loadedChunks = [];
      diagnostics.activeBiomeIds = [];
      diagnostics.urban.activeChunkCount = 0;
      diagnostics.urban.boxInstances = 0;
      diagnostics.urban.roofInstances = 0;
      diagnostics.urban.droppedInstances = 0;
      diagnostics.urban.chunks = [];
      diagnostics.poolSize = 0;
      activeSlots.clear();
      freeSlots.length = 0;
    },
  };

  return api;
}
