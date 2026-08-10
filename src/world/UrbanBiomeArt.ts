import * as THREE from 'three';
import {
  hashChunkCoordinates,
  isCityBiomeId,
  type BiomeDefinition,
  type CityBiomeId,
} from './BiomeCatalog';
import { createPropMaterial } from './BiomeWorldArt';
import type {
  WorldChunkPrototypeBatch,
  WorldChunkPrototypeTransform,
} from './WorldChunkSource';

export const URBAN_BOX_CAPACITY = 384;
export const URBAN_ROOF_CAPACITY = 128;
export const URBAN_BOX_ASSET_ID = 'existing-urban-box-pool';
export const URBAN_ROOF_ASSET_ID = 'existing-urban-roof-pool';

export type UrbanChunkStats = {
  boxCount: number;
  roofCount: number;
  droppedInstances: number;
  districtCount: number;
  visualRoles: readonly string[];
  landmarkId: string;
};

export type UrbanChunkSlot = {
  boxMesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  roofMesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  stats: UrbanChunkStats;
};

export type UrbanBiomeResources = {
  slots: UrbanChunkSlot[];
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
};

export type UrbanPopulationContext = {
  biome: BiomeDefinition;
  chunkX: number;
  chunkZ: number;
  chunkSize: number;
  seed: number;
  terrainHeight: (worldX: number, worldZ: number) => number;
  isReserved: (worldX: number, worldZ: number) => boolean;
};

type UrbanStyle = Readonly<{
  road: string;
  paving: string;
  structure: readonly string[];
  trim: string;
  glass: string;
  water: string;
  roles: readonly string[];
  landmarkId: string;
}>;

type Foundation = Readonly<{
  baseY: number;
  topY: number;
  relief: number;
}>;

const URBAN_STYLES: Record<CityBiomeId, UrbanStyle> = {
  'metropolitan-core': {
    road: '#27343b',
    paving: '#879696',
    structure: ['#507183', '#718a94', '#a7b5b7', '#d4d0bd'],
    trim: '#303e48',
    glass: '#63c8df',
    water: '#438da2',
    roles: [
      'arterial-road-grid',
      'downtown-towers',
      'residential-blocks',
      'civic-plazas',
      'roof-services',
      'window-facades',
      'street-traffic',
      'urban-parks',
      'skyline-landmark',
    ],
    landmarkId: 'aerium-spire',
  },
  'azure-harbor': {
    road: '#33444a',
    paving: '#8b9893',
    structure: ['#667b82', '#b9aa8f', '#d5c6a8', '#8a6d55'],
    trim: '#34464f',
    glass: '#78c4d2',
    water: '#237e98',
    roles: [
      'port-road-grid',
      'harbor-basins',
      'working-docks',
      'warehouse-quarter',
      'container-yards',
      'cargo-cranes',
      'service-traffic',
      'coastal-promenade',
      'lighthouse-landmark',
    ],
    landmarkId: 'azure-beacon',
  },
  'ironworks-district': {
    road: '#2d3132',
    paving: '#77756c',
    structure: ['#665d52', '#827764', '#9d8b70', '#52595b'],
    trim: '#d49a3b',
    glass: '#8eb4b4',
    water: '#55757a',
    roles: [
      'heavy-road-grid',
      'factory-halls',
      'rail-yards',
      'tank-farms',
      'pipe-racks',
      'warehouse-belt',
      'power-infrastructure',
      'freight-traffic',
      'foundry-landmark',
    ],
    landmarkId: 'grand-foundry',
  },
  'sunstone-citadel': {
    road: '#72513b',
    paving: '#c69b67',
    structure: ['#c46f43', '#d78d55', '#e9b878', '#f0d39d'],
    trim: '#8f4f36',
    glass: '#48a2a5',
    water: '#3e98a5',
    roles: [
      'citadel-street-grid',
      'adobe-quarters',
      'courtyard-houses',
      'market-bazaars',
      'defensive-walls',
      'solar-outskirts',
      'palm-gardens',
      'ceremonial-gates',
      'minaret-landmark',
    ],
    landmarkId: 'sunstone-minaret',
  },
};

const MATRIX_SCRATCH = new THREE.Matrix4();
const POSITION_SCRATCH = new THREE.Vector3();
const SCALE_SCRATCH = new THREE.Vector3();
const QUATERNION_SCRATCH = new THREE.Quaternion();
const EULER_SCRATCH = new THREE.Euler();
const COLOR_SCRATCH = new THREE.Color();

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

function addWhiteVertexColors(geometry: THREE.BufferGeometry): void {
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  colors.fill(1);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

function bakeSimpleFacetLight(geometry: THREE.BufferGeometry): void {
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  const normals = geometry.getAttribute('normal');
  const colors = geometry.getAttribute('color');
  for (let index = 0; index < normals.count; index += 1) {
    const intensity = THREE.MathUtils.clamp(
      0.7 + Math.max(0, normals.getY(index)) * 0.24
        + normals.getX(index) * -0.08
        + normals.getZ(index) * 0.05,
      0.58,
      1,
    );
    colors.setXYZ(
      index,
      colors.getX(index) * intensity,
      colors.getY(index) * intensity,
      colors.getZ(index) * intensity,
    );
  }
  colors.needsUpdate = true;
}

function createRoofGeometry(): THREE.BufferGeometry {
  const positions = new Float32Array([
    -0.5, 0, -0.5,
    0.5, 0, -0.5,
    -0.5, 0, 0.5,
    0.5, 0, 0.5,
    0, 0.5, -0.5,
    0, 0.5, 0.5,
  ]);
  const indices = [
    0, 1, 2, 1, 3, 2,
    0, 2, 4, 2, 5, 4,
    1, 4, 3, 3, 4, 5,
    0, 4, 1,
    2, 3, 5,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function createUrbanMaterial(): THREE.MeshBasicMaterial {
  const material = createPropMaterial('procedural-urban-volume', {
    roughness: 0.82,
    selfLight: 1,
  });
  const applyDirectionalFog = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    applyDirectionalFog(shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace(
        'varying vec3 vBiomeWorldPosition;',
        `varying vec3 vBiomeWorldPosition;
         varying vec3 vUrbanWorldNormal;
         varying float vUrbanScaleY;`,
      )
      .replace(
        'vec4 biomeWorldPosition = vec4(transformed, 1.0);',
        `vec3 urbanObjectNormal = vec3(normal);
         #ifdef USE_INSTANCING
           vUrbanScaleY = length(instanceMatrix[1].xyz);
           mat3 urbanInstanceNormalMatrix = mat3(instanceMatrix);
           urbanObjectNormal /= vec3(
             dot(urbanInstanceNormalMatrix[0], urbanInstanceNormalMatrix[0]),
             dot(urbanInstanceNormalMatrix[1], urbanInstanceNormalMatrix[1]),
             dot(urbanInstanceNormalMatrix[2], urbanInstanceNormalMatrix[2])
           );
           urbanObjectNormal = urbanInstanceNormalMatrix * urbanObjectNormal;
         #else
           vUrbanScaleY = 1.0;
         #endif
         vec3 urbanViewNormal = normalMatrix * urbanObjectNormal;
         vUrbanWorldNormal = inverseTransformDirection(urbanViewNormal, viewMatrix);
         vec4 biomeWorldPosition = vec4(transformed, 1.0);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'varying vec3 vBiomeWorldPosition;',
        `varying vec3 vBiomeWorldPosition;
         varying vec3 vUrbanWorldNormal;
         varying float vUrbanScaleY;`,
      )
      .replace(
        'float biomeFogFactor = smoothstep(fogNear, fogFar, vFogDepth);',
        `float urbanVerticalFace = 1.0 - smoothstep(
           0.36,
           0.76,
           abs(vUrbanWorldNormal.y)
         );
         float urbanBuilding = smoothstep(4.5, 9.0, vUrbanScaleY);
         float urbanFacadeAxis = abs(vUrbanWorldNormal.x) > abs(vUrbanWorldNormal.z)
           ? vBiomeWorldPosition.z
           : vBiomeWorldPosition.x;
         vec2 urbanWindowCell = fract(vec2(
           urbanFacadeAxis * 0.105,
           vBiomeWorldPosition.y * 0.18
         ));
         float urbanWindowShape = smoothstep(0.12, 0.19, urbanWindowCell.x)
           * (1.0 - smoothstep(0.70, 0.78, urbanWindowCell.x))
           * smoothstep(0.16, 0.23, urbanWindowCell.y)
           * (1.0 - smoothstep(0.68, 0.77, urbanWindowCell.y));
         float urbanWindowSeed = fract(sin(
           floor(urbanFacadeAxis * 0.105) * 12.9898
           + floor(vBiomeWorldPosition.y * 0.18) * 78.233
         ) * 43758.5453);
         vec3 urbanWindowColor = mix(
           vec3(0.055, 0.18, 0.25),
           vec3(0.96, 0.66, 0.3),
           step(0.67, urbanWindowSeed) * 0.7
         );
         float urbanWindowMask = urbanVerticalFace * urbanBuilding
           * urbanWindowShape * 0.72;
         gl_FragColor.rgb = mix(
           gl_FragColor.rgb,
           urbanWindowColor,
           urbanWindowMask
         );
         float biomeFogFactor = smoothstep(fogNear, fogFar, vFogDepth);`,
      );
  };
  material.customProgramCacheKey = () => 'procedural-urban-directional-fog-windows-v2';
  return material;
}

function createUrbanMesh(
  geometry: THREE.BufferGeometry,
  material: THREE.MeshBasicMaterial,
  capacity: number,
  name: string,
): THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.name = name;
  mesh.count = 0;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = true;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return mesh;
}

function emptyStats(): UrbanChunkStats {
  return {
    boxCount: 0,
    roofCount: 0,
    droppedInstances: 0,
    districtCount: 0,
    visualRoles: [],
    landmarkId: '',
  };
}

export function createUrbanBiomeResources(
  group: THREE.Group,
  slotCount: number,
): UrbanBiomeResources {
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  boxGeometry.translate(0, 0.5, 0);
  addWhiteVertexColors(boxGeometry);
  bakeSimpleFacetLight(boxGeometry);
  const roofGeometry = createRoofGeometry();
  addWhiteVertexColors(roofGeometry);
  bakeSimpleFacetLight(roofGeometry);
  const material = createUrbanMaterial();
  const slots: UrbanChunkSlot[] = [];

  for (let index = 0; index < slotCount; index += 1) {
    const boxMesh = createUrbanMesh(
      boxGeometry,
      material,
      URBAN_BOX_CAPACITY,
      `streamed-urban-box-slot-${String(index)}`,
    );
    const roofMesh = createUrbanMesh(
      roofGeometry,
      material,
      URBAN_ROOF_CAPACITY,
      `streamed-urban-roof-slot-${String(index)}`,
    );
    group.add(boxMesh, roofMesh);
    slots.push({ boxMesh, roofMesh, stats: emptyStats() });
  }

  return {
    slots,
    geometries: [boxGeometry, roofGeometry],
    materials: [material],
  };
}

export function clearUrbanChunk(slot: UrbanChunkSlot): void {
  slot.boxMesh.count = 0;
  slot.roofMesh.count = 0;
  slot.stats = emptyStats();
}

function writeInstance(
  slot: UrbanChunkSlot,
  kind: 'box' | 'roof',
  x: number,
  baseY: number,
  z: number,
  width: number,
  height: number,
  depth: number,
  color: THREE.ColorRepresentation,
  rotationX = 0,
  rotationY = 0,
  rotationZ = 0,
): void {
  const mesh = kind === 'box' ? slot.boxMesh : slot.roofMesh;
  const capacity = kind === 'box' ? URBAN_BOX_CAPACITY : URBAN_ROOF_CAPACITY;
  const index = kind === 'box' ? slot.stats.boxCount : slot.stats.roofCount;
  if (index >= capacity) {
    slot.stats.droppedInstances += 1;
    return;
  }
  POSITION_SCRATCH.set(x, baseY, z);
  SCALE_SCRATCH.set(width, height, depth);
  EULER_SCRATCH.set(rotationX, rotationY, rotationZ);
  QUATERNION_SCRATCH.setFromEuler(EULER_SCRATCH);
  MATRIX_SCRATCH.compose(POSITION_SCRATCH, QUATERNION_SCRATCH, SCALE_SCRATCH);
  mesh.setMatrixAt(index, MATRIX_SCRATCH);
  mesh.setColorAt(index, COLOR_SCRATCH.set(color));
  if (kind === 'box') slot.stats.boxCount += 1;
  else slot.stats.roofCount += 1;
}

function sampleFoundation(
  context: UrbanPopulationContext,
  localX: number,
  localZ: number,
  halfWidth: number,
  halfDepth: number,
): Foundation {
  const centerX = context.chunkX * context.chunkSize;
  const centerZ = context.chunkZ * context.chunkSize;
  const worldX = centerX + localX;
  const worldZ = centerZ + localZ;
  let minimum = context.terrainHeight(worldX, worldZ);
  let maximum = minimum;
  const sample = (offsetX: number, offsetZ: number): void => {
    const height = context.terrainHeight(worldX + offsetX, worldZ + offsetZ);
    minimum = Math.min(minimum, height);
    maximum = Math.max(maximum, height);
  };
  sample(-halfWidth, -halfDepth);
  sample(halfWidth, -halfDepth);
  sample(-halfWidth, halfDepth);
  sample(halfWidth, halfDepth);
  return {
    baseY: minimum - 0.42,
    topY: maximum + 0.16,
    relief: maximum - minimum,
  };
}

function colorFrom(
  colors: readonly string[],
  random: () => number,
): string {
  return colors[Math.floor(random() * colors.length)] ?? colors[0];
}

function addRoadNetwork(
  slot: UrbanChunkSlot,
  context: UrbanPopulationContext,
  style: UrbanStyle,
  cells: number,
  spacing: number,
  roadWidth: number,
): void {
  const halfChunk = context.chunkSize * 0.5;
  for (let row = 0; row < cells; row += 1) {
    const boundaryZ = -halfChunk + row * spacing;
    for (let column = 0; column < cells; column += 1) {
      const centerX = -halfChunk + (column + 0.5) * spacing;
      const worldX = context.chunkX * context.chunkSize + centerX;
      const worldZ = context.chunkZ * context.chunkSize + boundaryZ;
      if (context.isReserved(worldX, worldZ)) continue;
      const foundation = sampleFoundation(
        context,
        centerX,
        boundaryZ,
        spacing * 0.5,
        roadWidth * 0.5,
      );
      writeInstance(
        slot,
        'box',
        centerX,
        foundation.baseY,
        boundaryZ,
        spacing + 0.4,
        foundation.topY - foundation.baseY,
        roadWidth,
        style.road,
      );
    }
  }
  for (let column = 0; column < cells; column += 1) {
    const boundaryX = -halfChunk + column * spacing;
    for (let row = 0; row < cells; row += 1) {
      const centerZ = -halfChunk + (row + 0.5) * spacing;
      const worldX = context.chunkX * context.chunkSize + boundaryX;
      const worldZ = context.chunkZ * context.chunkSize + centerZ;
      if (context.isReserved(worldX, worldZ)) continue;
      const foundation = sampleFoundation(
        context,
        boundaryX,
        centerZ,
        roadWidth * 0.5,
        spacing * 0.5,
      );
      writeInstance(
        slot,
        'box',
        boundaryX,
        foundation.baseY + 0.015,
        centerZ,
        roadWidth,
        foundation.topY - foundation.baseY,
        spacing + 0.4,
        style.road,
      );
    }
  }
}

function addMetroBlock(
  slot: UrbanChunkSlot,
  foundation: Foundation,
  x: number,
  z: number,
  column: number,
  row: number,
  random: () => number,
  style: UrbanStyle,
): void {
  const distance = Math.hypot(column - 3.5, row - 3.5);
  if (column === 4 && row === 4) {
    writeInstance(slot, 'box', x, foundation.topY, z, 78, 5, 78, '#93a0a0');
    writeInstance(slot, 'box', x, foundation.topY + 5, z, 48, 40, 48, '#8099a4');
    writeInstance(slot, 'box', x, foundation.topY + 45, z, 36, 38, 36, '#66889b');
    writeInstance(slot, 'box', x, foundation.topY + 83, z, 24, 30, 24, '#4f7488');
    writeInstance(slot, 'roof', x, foundation.topY + 113, z, 18, 14, 18, style.glass);
    return;
  }
  const downtown = distance < 2.55;
  const height = downtown ? 38 + random() * 48 : 15 + random() * 26;
  const width = downtown ? 38 + random() * 32 : 52 + random() * 42;
  const depth = downtown ? 38 + random() * 32 : 48 + random() * 46;
  const structure = colorFrom(style.structure, random);
  writeInstance(slot, 'box', x, foundation.topY, z, width, height, depth, structure);
  writeInstance(
    slot,
    'roof',
    x,
    foundation.topY + height,
    z,
    width * 0.72,
    2.4 + random() * 2.6,
    depth * 0.72,
    random() > 0.45 ? style.trim : style.glass,
    0,
    random() > 0.5 ? Math.PI * 0.5 : 0,
  );
  if (random() > 0.58) {
    const side = random() > 0.5 ? 1 : -1;
    writeInstance(
      slot,
      'box',
      x + side * (width * 0.42 + 12),
      foundation.topY,
      z + (random() - 0.5) * 24,
      18 + random() * 15,
      height * (0.35 + random() * 0.24),
      24 + random() * 26,
      colorFrom(style.structure, random),
    );
  }
}

function addHarborBlock(
  slot: UrbanChunkSlot,
  foundation: Foundation,
  x: number,
  z: number,
  column: number,
  row: number,
  random: () => number,
  style: UrbanStyle,
): void {
  if (column === 0 && row === 0) {
    writeInstance(slot, 'box', x, foundation.topY, z, 74, 2.4, 74, '#8c8f83');
    writeInstance(slot, 'box', x, foundation.topY + 2.4, z, 17, 48, 17, '#e2ddc8');
    writeInstance(slot, 'box', x, foundation.topY + 50.4, z, 24, 8, 24, '#c76b38');
    writeInstance(slot, 'roof', x, foundation.topY + 58.4, z, 25, 8, 25, style.glass);
    return;
  }
  if (row <= 2) {
    const dockZ = z + (row % 2 === 0 ? -34 : 34);
    writeInstance(slot, 'box', x, foundation.topY, dockZ, 116, 1.4, 22, '#746a5b');
    if ((column + row) % 2 === 0) {
      for (let container = 0; container < 3; container += 1) {
        writeInstance(
          slot,
          'box',
          x - 34 + container * 28,
          foundation.topY + 1.4,
          dockZ,
          23,
          4.8 + (container % 2) * 4.8,
          10,
          [style.trim, '#b94f38', '#487f8a'][container],
        );
      }
    }
    if ((column + row * 3) % 4 === 0) {
      const craneX = x + 42;
      writeInstance(slot, 'box', craneX, foundation.topY + 1, dockZ, 4, 34, 4, '#d28a37');
      writeInstance(slot, 'box', craneX - 18, foundation.topY + 32, dockZ, 40, 3, 3, '#d28a37', 0, 0, -0.12);
      writeInstance(slot, 'box', craneX - 35, foundation.topY + 17, dockZ, 2, 18, 2, '#3d4445');
    }
    return;
  }
  const width = 88 + random() * 30;
  const depth = 62 + random() * 40;
  const height = 9 + random() * 8;
  writeInstance(
    slot,
    'box',
    x,
    foundation.topY,
    z,
    width,
    height,
    depth,
    colorFrom(style.structure, random),
  );
  writeInstance(slot, 'roof', x, foundation.topY + height, z, width, 5, depth, style.trim);
  if (random() > 0.48) {
    writeInstance(
      slot,
      'box',
      x + (random() - 0.5) * 50,
      foundation.topY,
      z + depth * 0.55,
      30,
      5,
      11,
      random() > 0.5 ? '#c45d3b' : '#3f7a87',
    );
  }
}

function addIndustrialBlock(
  slot: UrbanChunkSlot,
  foundation: Foundation,
  x: number,
  z: number,
  column: number,
  row: number,
  random: () => number,
  style: UrbanStyle,
): void {
  if (column === 4 && row === 3) {
    writeInstance(slot, 'box', x, foundation.topY, z, 104, 16, 88, '#5e554c');
    writeInstance(slot, 'roof', x, foundation.topY + 16, z, 104, 7, 88, style.trim);
    writeInstance(slot, 'box', x - 28, foundation.topY + 16, z, 15, 62, 15, '#4a4d4d');
    writeInstance(slot, 'box', x + 26, foundation.topY + 16, z + 8, 13, 48, 13, '#6a5c4d');
    writeInstance(slot, 'roof', x - 28, foundation.topY + 78, z, 18, 8, 18, '#d18832');
    return;
  }
  if (column <= 1) {
    for (let rail = -1; rail <= 1; rail += 1) {
      writeInstance(
        slot,
        'box',
        x + rail * 24,
        foundation.topY,
        z,
        3,
        0.65,
        126,
        rail === 0 ? '#54504a' : '#858077',
      );
    }
    if (row % 2 === 0) {
      writeInstance(slot, 'box', x, foundation.topY + 0.65, z, 74, 7, 18, '#7d5c40');
    }
    return;
  }
  const width = 82 + random() * 34;
  const depth = 66 + random() * 48;
  const height = 12 + random() * 15;
  writeInstance(
    slot,
    'box',
    x,
    foundation.topY,
    z,
    width,
    height,
    depth,
    colorFrom(style.structure, random),
  );
  writeInstance(slot, 'roof', x, foundation.topY + height, z, width, 5.5, depth, style.trim);
  if ((column + row) % 3 === 0) {
    writeInstance(slot, 'box', x - width * 0.3, foundation.topY + height, z, 7, 24, 7, '#444849');
    writeInstance(slot, 'box', x + width * 0.24, foundation.topY + height, z + 8, 6, 17, 6, '#78634c');
  } else if (random() > 0.52) {
    writeInstance(slot, 'box', x + width * 0.54, foundation.topY, z, 18, 9, 28, '#4d5555');
  }
}

function addDesertBlock(
  slot: UrbanChunkSlot,
  foundation: Foundation,
  x: number,
  z: number,
  column: number,
  row: number,
  random: () => number,
  style: UrbanStyle,
): void {
  const outer = column === 0 || column === 7 || row === 0 || row === 7;
  if (column === 4 && row === 4) {
    writeInstance(slot, 'box', x, foundation.topY, z, 82, 5, 82, '#d9ac71');
    writeInstance(slot, 'box', x, foundation.topY + 5, z, 26, 52, 26, '#db8d56');
    writeInstance(slot, 'box', x, foundation.topY + 57, z, 18, 18, 18, '#ba5e3d');
    writeInstance(slot, 'roof', x, foundation.topY + 75, z, 20, 13, 20, style.glass);
    return;
  }
  if (outer) {
    const rotation = (column === 0 || column === 7) ? Math.PI * 0.5 : 0;
    for (let panel = -1; panel <= 1; panel += 1) {
      writeInstance(
        slot,
        'box',
        x + (rotation === 0 ? panel * 34 : 0),
        foundation.topY + 5.4,
        z + (rotation === 0 ? 0 : panel * 34),
        28,
        1.1,
        46,
        '#2f7280',
        -0.23,
        rotation,
      );
    }
    writeInstance(
      slot,
      'box',
      x,
      foundation.topY,
      z + (row === 0 ? -58 : row === 7 ? 58 : 0),
      column === 0 || column === 7 ? 5 : 128,
      7,
      column === 0 || column === 7 ? 128 : 5,
      '#a75f3e',
    );
    return;
  }
  const width = 48 + random() * 46;
  const depth = 45 + random() * 45;
  const height = 8 + random() * 13;
  writeInstance(
    slot,
    'box',
    x,
    foundation.topY,
    z,
    width,
    height,
    depth,
    colorFrom(style.structure, random),
  );
  if ((column + row) % 3 === 0) {
    writeInstance(
      slot,
      'roof',
      x,
      foundation.topY + height,
      z,
      width * 0.88,
      4.5,
      depth * 0.88,
      style.trim,
      0,
      random() > 0.5 ? Math.PI * 0.5 : 0,
    );
  } else {
    writeInstance(
      slot,
      'box',
      x + width * 0.42,
      foundation.topY,
      z - depth * 0.36,
      20 + random() * 16,
      height * 0.55,
      20 + random() * 16,
      colorFrom(style.structure, random),
    );
  }
  if ((column * 3 + row) % 5 === 0) {
    writeInstance(
      slot,
      'roof',
      x,
      foundation.topY + 3.2,
      z + depth * 0.62,
      width * 0.9,
      2.6,
      18,
      style.glass,
    );
  }
}

function finalizeUrbanSlot(slot: UrbanChunkSlot): void {
  slot.boxMesh.count = slot.stats.boxCount;
  slot.roofMesh.count = slot.stats.roofCount;
  slot.boxMesh.instanceMatrix.needsUpdate = true;
  slot.roofMesh.instanceMatrix.needsUpdate = true;
  if (slot.boxMesh.instanceColor) slot.boxMesh.instanceColor.needsUpdate = true;
  if (slot.roofMesh.instanceColor) slot.roofMesh.instanceColor.needsUpdate = true;
  if (slot.stats.boxCount > 0) {
    slot.boxMesh.computeBoundingBox();
    slot.boxMesh.computeBoundingSphere();
  }
  if (slot.stats.roofCount > 0) {
    slot.roofMesh.computeBoundingBox();
    slot.roofMesh.computeBoundingSphere();
  }
}

export function populateUrbanChunk(
  slot: UrbanChunkSlot,
  context: UrbanPopulationContext,
): void {
  clearUrbanChunk(slot);
  slot.boxMesh.position.set(
    context.chunkX * context.chunkSize,
    0,
    context.chunkZ * context.chunkSize,
  );
  slot.roofMesh.position.copy(slot.boxMesh.position);
  slot.boxMesh.userData.chunkKey = `${String(context.chunkX)}:${String(context.chunkZ)}`;
  slot.roofMesh.userData.chunkKey = slot.boxMesh.userData.chunkKey;
  slot.boxMesh.userData.biomeId = context.biome.id;
  slot.roofMesh.userData.biomeId = context.biome.id;

  if (!isCityBiomeId(context.biome.id)) return;
  const biomeId = context.biome.id;
  const style = URBAN_STYLES[biomeId];
  slot.stats.visualRoles = style.roles;
  slot.stats.landmarkId = style.landmarkId;
  slot.stats.districtCount = 4;
  const random = createRandom(hashChunkCoordinates(
    context.chunkX,
    context.chunkZ,
    context.seed ^ 0x36c7a451,
  ));
  const cells = 8;
  const spacing = context.chunkSize / cells;
  const halfChunk = context.chunkSize * 0.5;
  const plotSize = spacing - 30;
  addRoadNetwork(slot, context, style, cells, spacing, 30);

  for (let row = 0; row < cells; row += 1) {
    for (let column = 0; column < cells; column += 1) {
      const x = -halfChunk + (column + 0.5) * spacing;
      const z = -halfChunk + (row + 0.5) * spacing;
      const worldX = context.chunkX * context.chunkSize + x;
      const worldZ = context.chunkZ * context.chunkSize + z;
      if (context.isReserved(worldX, worldZ)) continue;
      const foundation = sampleFoundation(
        context,
        x,
        z,
        plotSize * 0.5,
        plotSize * 0.5,
      );
      const pavingColor = biomeId === 'azure-harbor' && row <= 2
        ? style.water
        : style.paving;
      writeInstance(
        slot,
        'box',
        x,
        foundation.baseY,
        z,
        plotSize,
        foundation.topY - foundation.baseY,
        plotSize,
        pavingColor,
      );
      switch (biomeId) {
        case 'metropolitan-core':
          addMetroBlock(slot, foundation, x, z, column, row, random, style);
          break;
        case 'azure-harbor':
          addHarborBlock(slot, foundation, x, z, column, row, random, style);
          break;
        case 'ironworks-district':
          addIndustrialBlock(slot, foundation, x, z, column, row, random, style);
          break;
        case 'sunstone-citadel':
          addDesertBlock(slot, foundation, x, z, column, row, random, style);
          break;
      }
    }
  }

  finalizeUrbanSlot(slot);
}

function serializeUrbanMesh(
  mesh: THREE.InstancedMesh,
  count: number,
): readonly WorldChunkPrototypeTransform[] {
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();
  const transforms: WorldChunkPrototypeTransform[] = [];
  for (let index = 0; index < count; index += 1) {
    mesh.getMatrixAt(index, matrix);
    matrix.decompose(position, rotation, scale);
    mesh.getColorAt(index, color);
    transforms.push({
      translation: [
        Math.fround(position.x),
        Math.fround(position.y),
        Math.fround(position.z),
      ],
      rotation: [
        Math.fround(rotation.x),
        Math.fround(rotation.y),
        Math.fround(rotation.z),
        Math.fround(rotation.w),
      ],
      scale: [
        Math.fround(scale.x),
        Math.fround(scale.y),
        Math.fround(scale.z),
      ],
      colorLinearRgb: [
        Math.fround(color.r),
        Math.fround(color.g),
        Math.fround(color.b),
      ],
    });
  }
  return transforms;
}

/** Offline-only identity export of the existing urban composition. */
export function createProceduralUrbanPrototypeBatches(
  context: UrbanPopulationContext,
): readonly WorldChunkPrototypeBatch[] {
  if (!isCityBiomeId(context.biome.id)) return [];
  const group = new THREE.Group();
  const resources = createUrbanBiomeResources(group, 1);
  const slot = resources.slots[0];
  try {
    populateUrbanChunk(slot, context);
    return [
      {
        assetId: URBAN_BOX_ASSET_ID,
        transforms: serializeUrbanMesh(slot.boxMesh, slot.stats.boxCount),
      },
      {
        assetId: URBAN_ROOF_ASSET_ID,
        transforms: serializeUrbanMesh(slot.roofMesh, slot.stats.roofCount),
      },
    ];
  } finally {
    resources.geometries.forEach((geometry) => geometry.dispose());
    resources.materials.forEach((material) => material.dispose());
  }
}

export function populateAuthoredUrbanPrototypeBatches(
  slot: UrbanChunkSlot,
  context: UrbanPopulationContext,
  batches: readonly WorldChunkPrototypeBatch[],
): void {
  clearUrbanChunk(slot);
  slot.boxMesh.position.set(
    context.chunkX * context.chunkSize,
    0,
    context.chunkZ * context.chunkSize,
  );
  slot.roofMesh.position.copy(slot.boxMesh.position);
  slot.boxMesh.userData.chunkKey = `${String(context.chunkX)}:${String(context.chunkZ)}`;
  slot.roofMesh.userData.chunkKey = slot.boxMesh.userData.chunkKey;
  slot.boxMesh.userData.biomeId = context.biome.id;
  slot.roofMesh.userData.biomeId = context.biome.id;
  if (!isCityBiomeId(context.biome.id)) return;

  const style = URBAN_STYLES[context.biome.id];
  slot.stats.visualRoles = style.roles;
  slot.stats.landmarkId = style.landmarkId;
  slot.stats.districtCount = 4;
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();

  const writeBatch = (
    assetId: string,
    mesh: THREE.InstancedMesh,
    capacity: number,
    kind: 'box' | 'roof',
  ): void => {
    const batch = batches.find((candidate) => candidate.assetId === assetId);
    if (!batch) return;
    batch.transforms.forEach((transform) => {
      const index = kind === 'box' ? slot.stats.boxCount : slot.stats.roofCount;
      if (index >= capacity) {
        slot.stats.droppedInstances += 1;
        return;
      }
      position.fromArray(transform.translation);
      rotation.fromArray(transform.rotation);
      scale.fromArray(transform.scale);
      matrix.compose(position, rotation, scale);
      color.setRGB(
        transform.colorLinearRgb[0],
        transform.colorLinearRgb[1],
        transform.colorLinearRgb[2],
        THREE.LinearSRGBColorSpace,
      );
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, color);
      if (kind === 'box') slot.stats.boxCount += 1;
      else slot.stats.roofCount += 1;
    });
  };

  writeBatch(URBAN_BOX_ASSET_ID, slot.boxMesh, URBAN_BOX_CAPACITY, 'box');
  writeBatch(URBAN_ROOF_ASSET_ID, slot.roofMesh, URBAN_ROOF_CAPACITY, 'roof');
  finalizeUrbanSlot(slot);
}
