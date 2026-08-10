import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BiomeDefinition, BiomeId } from './BiomeCatalog';

export const BIOME_PROP_FAMILIES = [
  'trunk',
  'canopy',
  'conifer',
  'frond',
  'groundCover',
  'reed',
  'cactus',
  'deadwood',
  'rock',
  'mesa',
  'crystal',
  'snow',
  'water',
  'glow',
] as const;

export type BiomePropFamily = (typeof BIOME_PROP_FAMILIES)[number];

export const BIOME_PROP_FAMILY_BY_ASSET_ID = {
  'proto-biome-trunk': 'trunk',
  'proto-biome-canopy': 'canopy',
  'proto-biome-conifer': 'conifer',
  'proto-biome-frond': 'frond',
  'proto-biome-ground-cover': 'groundCover',
  'proto-biome-reed': 'reed',
  'proto-biome-cactus': 'cactus',
  'proto-biome-deadwood': 'deadwood',
  'proto-biome-rock': 'rock',
  'proto-biome-mesa': 'mesa',
  'proto-biome-crystal': 'crystal',
  'proto-biome-snow': 'snow',
  'proto-biome-water': 'water',
  'proto-biome-glow': 'glow',
} as const satisfies Record<string, BiomePropFamily>;

export type BiomePropAssetId = keyof typeof BIOME_PROP_FAMILY_BY_ASSET_ID;

export const BIOME_PROP_ASSET_ID_BY_FAMILY = Object.freeze(
  Object.fromEntries(
    Object.entries(BIOME_PROP_FAMILY_BY_ASSET_ID).map(([assetId, family]) => [
      family,
      assetId,
    ]),
  ) as Record<BiomePropFamily, BiomePropAssetId>,
);

export type BiomePropAccumulator = {
  mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  count: number;
};

export type BiomePropAccumulators = Record<BiomePropFamily, BiomePropAccumulator>;

export type BiomePropResources = {
  accumulators: BiomePropAccumulators;
  geometries: THREE.BufferGeometry[];
  materials: THREE.MeshBasicMaterial[];
};

export type BiomeHorizonSystem = {
  group: THREE.Group;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
  update: (focusPosition: Readonly<THREE.Vector3>, biome: BiomeDefinition) => void;
};

type GeometryPart = {
  geometry: THREE.BufferGeometry;
  position?: readonly [number, number, number];
  scale?: readonly [number, number, number];
  rotation?: readonly [number, number, number];
};

const HORIZON_COLOR_SCRATCH = new THREE.Color();
const HORIZON_FOG_COLOR = new THREE.Color('#d5e4e5');

function mergeParts(parts: GeometryPart[]): THREE.BufferGeometry {
  const transformed = parts.map((part) => {
    const geometry = part.geometry;
    const scale = part.scale ?? [1, 1, 1];
    const rotation = part.rotation ?? [0, 0, 0];
    const position = part.position ?? [0, 0, 0];
    geometry.scale(scale[0], scale[1], scale[2]);
    geometry.rotateX(rotation[0]);
    geometry.rotateY(rotation[1]);
    geometry.rotateZ(rotation[2]);
    geometry.translate(position[0], position[1], position[2]);
    return geometry;
  });
  const merged = mergeGeometries(transformed, false);
  if (!merged) throw new Error('Unable to merge biome prop geometry.');
  merged.computeVertexNormals();
  return merged;
}

function alignGeometryMinY(
  geometry: THREE.BufferGeometry,
  targetMinY = 0,
): THREE.BufferGeometry {
  geometry.computeBoundingBox();
  const minimumY = geometry.boundingBox?.min.y ?? 0;
  geometry.translate(0, targetMinY - minimumY, 0);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function bakeFacetLighting(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  const normals = geometry.getAttribute('normal');
  const colors = new Float32Array(normals.count * 3);
  for (let index = 0; index < normals.count; index += 1) {
    const normalY = Math.max(0, normals.getY(index));
    const sideLight = normals.getX(index) * -0.12 + normals.getZ(index) * 0.08;
    const intensity = THREE.MathUtils.clamp(0.68 + normalY * 0.28 + sideLight, 0.52, 1);
    const offset = index * 3;
    colors[offset] = intensity;
    colors[offset + 1] = intensity;
    colors[offset + 2] = intensity;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function createCanopyGeometry(): THREE.BufferGeometry {
  // Tree placement supplies half a crown-width as its center offset. Keeping
  // the local base at -0.74 makes the visible crown meet the trunk instead of
  // hovering above it for both the green and wider autumn variants.
  return alignGeometryMinY(mergeParts([
    {
      geometry: new THREE.IcosahedronGeometry(0.72, 0),
      position: [-0.42, 0.04, 0.05],
      scale: [1.08, 0.78, 0.9],
    },
    {
      geometry: new THREE.IcosahedronGeometry(0.78, 0),
      position: [0.38, 0.08, 0],
      scale: [1.02, 0.83, 0.92],
    },
    {
      geometry: new THREE.IcosahedronGeometry(0.68, 0),
      position: [0, 0.42, -0.08],
      scale: [0.94, 0.82, 0.9],
    },
  ]), -0.74);
}

function createConiferGeometry(): THREE.BufferGeometry {
  // InfiniteBiomeWorld places conifers at +0.06 of their final height.
  // Matching that support offset keeps the lowest bough exactly on terrain.
  return alignGeometryMinY(mergeParts([
    {
      geometry: new THREE.ConeGeometry(0.72, 0.62, 8, 1),
      position: [0, 0.3, 0],
    },
    {
      geometry: new THREE.ConeGeometry(0.58, 0.56, 8, 1),
      position: [0, 0.57, 0],
    },
    {
      geometry: new THREE.ConeGeometry(0.42, 0.48, 8, 1),
      position: [0, 0.82, 0],
    },
  ]), -0.06);
}

function createFrondGeometry(): THREE.BufferGeometry {
  const parts: GeometryPart[] = [];
  for (let index = 0; index < 7; index += 1) {
    const angle = index / 7 * Math.PI * 2;
    parts.push({
      geometry: new THREE.ConeGeometry(0.12, 1.45, 5, 1),
      position: [Math.cos(angle) * 0.62, -0.08, Math.sin(angle) * 0.62],
      scale: [0.8, 1, 0.46],
      rotation: [Math.sin(angle) * 1.23, angle, -Math.cos(angle) * 1.23],
    });
  }
  return mergeParts(parts);
}

function createGroundCoverGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let blade = 0; blade < 5; blade += 1) {
    const angle = blade / 5 * Math.PI * 2;
    const sideX = Math.cos(angle) * 0.26;
    const sideZ = Math.sin(angle) * 0.26;
    const tipX = Math.cos(angle + 0.22) * 0.14;
    const tipZ = Math.sin(angle + 0.22) * 0.14;
    const base = positions.length / 3;
    positions.push(-sideX, 0, -sideZ, sideX, 0, sideZ, tipX, 1, tipZ);
    indices.push(base, base + 1, base + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return alignGeometryMinY(geometry);
}

function createReedGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let index = 0; index < 6; index += 1) {
    const angle = index * 2.399963;
    const radius = 0.16 + (index % 2) * 0.11;
    const height = 0.72 + (index % 3) * 0.14;
    const centerX = Math.cos(angle) * radius;
    const centerZ = Math.sin(angle) * radius;
    const sideX = Math.cos(angle + Math.PI * 0.5) * 0.035;
    const sideZ = Math.sin(angle + Math.PI * 0.5) * 0.035;
    const leanX = Math.cos(angle) * (index - 2.5) * 0.012;
    const leanZ = Math.sin(angle) * (index - 2.5) * 0.012;
    const base = positions.length / 3;
    positions.push(
      centerX - sideX, 0, centerZ - sideZ,
      centerX + sideX, 0, centerZ + sideZ,
      centerX + sideX * 0.46 + leanX, height * 0.82, centerZ + sideZ * 0.46 + leanZ,
      centerX - sideX * 0.46 + leanX, height * 0.82, centerZ - sideZ * 0.46 + leanZ,
      centerX + leanX, height, centerZ + leanZ,
    );
    indices.push(
      base, base + 1, base + 2,
      base, base + 2, base + 3,
      base + 3, base + 2, base + 4,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return alignGeometryMinY(geometry);
}

function createCactusGeometry(): THREE.BufferGeometry {
  return alignGeometryMinY(mergeParts([
    {
      geometry: new THREE.CylinderGeometry(0.2, 0.25, 1, 7, 2),
      position: [0, 0.5, 0],
    },
    {
      geometry: new THREE.CylinderGeometry(0.13, 0.15, 0.48, 7, 1),
      position: [0.27, 0.62, 0],
      rotation: [0, 0, Math.PI * 0.5],
    },
    {
      geometry: new THREE.CylinderGeometry(0.12, 0.14, 0.42, 7, 1),
      position: [0.48, 0.82, 0],
    },
    {
      geometry: new THREE.CylinderGeometry(0.11, 0.14, 0.36, 7, 1),
      position: [-0.25, 0.48, 0.02],
      rotation: [0, 0, Math.PI * 0.5],
    },
    {
      geometry: new THREE.CylinderGeometry(0.1, 0.12, 0.34, 7, 1),
      position: [-0.42, 0.64, 0.02],
    },
  ]));
}

function createDeadwoodGeometry(): THREE.BufferGeometry {
  return alignGeometryMinY(mergeParts([
    {
      geometry: new THREE.CylinderGeometry(0.11, 0.22, 1, 7, 2),
      position: [0, 0.5, 0],
    },
    {
      geometry: new THREE.CylinderGeometry(0.06, 0.1, 0.64, 6, 1),
      position: [0.2, 0.7, 0],
      rotation: [0, 0, -0.72],
    },
    {
      geometry: new THREE.CylinderGeometry(0.05, 0.09, 0.5, 6, 1),
      position: [-0.17, 0.58, 0.08],
      rotation: [0.22, 0, 0.78],
    },
  ]));
}

function createFacetedRockGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(1, 0);
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const y = positions.getY(index);
    const z = positions.getZ(index);
    const variation = 0.86 + Math.sin(x * 8.7 + y * 6.1 + z * 9.3) * 0.1;
    positions.setXYZ(index, x * variation, y * variation * 0.58, z * variation);
  }
  geometry.computeVertexNormals();
  // Rock placement uses +0.42 * size as its center offset. A matching local
  // support plane exposes the full rock without lifting it above the ground.
  return alignGeometryMinY(geometry, -0.42);
}

function createMesaGeometry(): THREE.BufferGeometry {
  return alignGeometryMinY(mergeParts([
    {
      geometry: new THREE.CylinderGeometry(0.82, 1, 0.58, 7, 2),
      position: [0, 0.29, 0],
      scale: [1, 1, 0.72],
    },
    {
      geometry: new THREE.CylinderGeometry(0.66, 0.8, 0.3, 7, 1),
      position: [0.03, 0.72, -0.02],
      scale: [1, 1, 0.74],
    },
    {
      geometry: new THREE.CylinderGeometry(0.58, 0.62, 0.12, 7, 1),
      position: [-0.03, 0.93, 0.01],
      scale: [1, 1, 0.72],
    },
  ]));
}

function createCrystalGeometry(): THREE.BufferGeometry {
  return alignGeometryMinY(mergeParts([
    {
      geometry: new THREE.ConeGeometry(0.24, 1, 5, 1),
      position: [0, 0.5, 0],
    },
    {
      geometry: new THREE.ConeGeometry(0.18, 0.76, 5, 1),
      position: [0.24, 0.34, 0.05],
      rotation: [0.08, 0.3, -0.2],
    },
    {
      geometry: new THREE.ConeGeometry(0.15, 0.62, 5, 1),
      position: [-0.2, 0.27, -0.08],
      rotation: [-0.08, -0.4, 0.24],
    },
  ]));
}

function createSnowGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(1, 8, 3, 0, Math.PI * 2, 0, Math.PI * 0.5);
  geometry.scale(1, 0.22, 1);
  return alignGeometryMinY(geometry);
}

function createGlowFissureGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-1, -0.04);
  shape.lineTo(-0.54, 0.08);
  shape.lineTo(-0.14, -0.02);
  shape.lineTo(0.22, 0.07);
  shape.lineTo(0.58, -0.06);
  shape.lineTo(1, 0.03);
  shape.lineTo(0.56, -0.14);
  shape.lineTo(0.18, -0.05);
  shape.lineTo(-0.18, -0.14);
  shape.lineTo(-0.58, -0.03);
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI * 0.5);
  return alignGeometryMinY(geometry);
}

export function createPropMaterial(
  name: string,
  options: {
    roughness: number;
    metalness?: number;
    transparent?: boolean;
    opacity?: number;
    emissive?: THREE.ColorRepresentation;
    emissiveIntensity?: number;
    side?: THREE.Side;
    selfLight?: number;
  },
): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    name,
    color: '#ffffff',
    vertexColors: true,
    transparent: options.transparent ?? false,
    opacity: options.opacity ?? 1,
    depthWrite: !(options.transparent ?? false),
    side: options.side ?? THREE.FrontSide,
    fog: true,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.biomeSkyZenith = { value: new THREE.Color('#3f86c3') };
    shader.uniforms.biomeSkyUpper = { value: new THREE.Color('#82bfe3') };
    shader.uniforms.biomeSkyHorizon = { value: new THREE.Color('#c4d9df') };
    shader.uniforms.biomeSkyLower = { value: new THREE.Color('#e6d6ba') };
    shader.uniforms.biomeSkyHaze = { value: new THREE.Color('#c4d9df') };
    shader.uniforms.biomeSkySunHaze = { value: new THREE.Color('#f4c58e') };
    shader.uniforms.biomeSkySunDirection = {
      value: new THREE.Vector3(-0.48, 0.58, -0.65).normalize(),
    };
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vBiomeWorldPosition;\nvoid main() {')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
         vec4 biomeWorldPosition = vec4(transformed, 1.0);
         #ifdef USE_INSTANCING
           biomeWorldPosition = instanceMatrix * biomeWorldPosition;
         #endif
         vBiomeWorldPosition = (modelMatrix * biomeWorldPosition).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `varying vec3 vBiomeWorldPosition;
         uniform vec3 biomeSkyZenith;
         uniform vec3 biomeSkyUpper;
         uniform vec3 biomeSkyHorizon;
         uniform vec3 biomeSkyLower;
         uniform vec3 biomeSkyHaze;
         uniform vec3 biomeSkySunHaze;
         uniform vec3 biomeSkySunDirection;
         void main() {`,
      )
      .replace(
        '#include <fog_fragment>',
        `float biomeFogFactor = smoothstep(fogNear, fogFar, vFogDepth);
         vec3 biomeSkyDirection = normalize(vBiomeWorldPosition - cameraPosition);
         float biomeSkyHeight = biomeSkyDirection.y;
         float biomeSkyUpperBlend = smoothstep(0.34, 0.88, biomeSkyHeight);
         float biomeSkyHorizonBlend = smoothstep(-0.18, 0.055, biomeSkyHeight);
         float biomeSkyAerialBand = exp(-pow((biomeSkyHeight - 0.012) * 8.5, 2.0));
         vec3 biomeSkyColor = mix(
           biomeSkyLower,
           biomeSkyHorizon,
           biomeSkyHorizonBlend
         );
         biomeSkyColor = mix(
           biomeSkyColor,
           biomeSkyUpper,
           smoothstep(0.16, 0.56, biomeSkyHeight)
         );
         biomeSkyColor = mix(
           biomeSkyColor,
           biomeSkyZenith,
           biomeSkyUpperBlend
         );
         biomeSkyColor = mix(
           biomeSkyColor,
           biomeSkyHaze,
           biomeSkyAerialBand * 0.34
         );
         float biomeSkySunAmount = max(
           dot(biomeSkyDirection, normalize(biomeSkySunDirection)),
           0.0
         );
         float biomeSkyHorizonScatter = pow(biomeSkySunAmount, 5.0)
           * biomeSkyAerialBand * 0.22;
         float biomeSkyHalo = pow(biomeSkySunAmount, 18.0) * 0.20;
         float biomeSkyDisc = pow(biomeSkySunAmount, 460.0) * 0.78;
         biomeSkyColor = mix(
           biomeSkyColor,
           biomeSkySunHaze,
           biomeSkyHorizonScatter
         );
         biomeSkyColor += vec3(1.0, 0.77, 0.43) * biomeSkyHalo
           + vec3(1.0, 0.93, 0.76) * biomeSkyDisc;
         gl_FragColor.rgb = mix(gl_FragColor.rgb, biomeSkyColor, biomeFogFactor);`,
      );
  };
  material.customProgramCacheKey = () => 'biome-basic-directional-fog-v1';
  return material;
}

export function createBiomePropResources(
  group: THREE.Group,
  capacity: number,
): BiomePropResources {
  const groundCoverGeometry = createGroundCoverGeometry();
  const waterPatchGeometry = alignGeometryMinY(
    new THREE.CircleGeometry(1, 24).rotateX(-Math.PI * 0.5),
  );
  const geometries: Record<BiomePropFamily, THREE.BufferGeometry> = {
    // Trunks intentionally remain centered: their caller supplies height / 2.
    trunk: new THREE.CylinderGeometry(0.48, 0.72, 1, 8, 2),
    canopy: createCanopyGeometry(),
    conifer: createConiferGeometry(),
    frond: createFrondGeometry(),
    groundCover: groundCoverGeometry,
    reed: createReedGeometry(),
    cactus: createCactusGeometry(),
    deadwood: createDeadwoodGeometry(),
    rock: createFacetedRockGeometry(),
    mesa: createMesaGeometry(),
    crystal: createCrystalGeometry(),
    snow: createSnowGeometry(),
    water: waterPatchGeometry,
    glow: createGlowFissureGeometry(),
  };
  const materials = {
    bark: createPropMaterial('biome-bark-and-deadwood', {
      roughness: 0.94,
      selfLight: 0.82,
    }),
    foliage: createPropMaterial('biome-layered-foliage', {
      roughness: 0.84,
      selfLight: 1.12,
    }),
    ground: createPropMaterial('biome-ground-cover', {
      roughness: 0.92,
      side: THREE.DoubleSide,
      selfLight: 0.94,
    }),
    mineral: createPropMaterial('biome-faceted-mineral', {
      roughness: 0.7,
      metalness: 0.03,
      selfLight: 0.96,
    }),
    water: createPropMaterial('biome-water-and-ice', {
      roughness: 0.32,
      metalness: 0.02,
      transparent: true,
      opacity: 0.68,
      side: THREE.DoubleSide,
      selfLight: 0.9,
    }),
    snow: createPropMaterial('biome-opaque-snow-and-salt-crust', {
      roughness: 0.72,
      side: THREE.DoubleSide,
      selfLight: 1.08,
    }),
    crystal: createPropMaterial('biome-cool-crystal', {
      roughness: 0.28,
      metalness: 0.04,
      selfLight: 1.16,
    }),
    glow: createPropMaterial('biome-lava-and-crystal-glow', {
      roughness: 0.4,
      emissive: '#ff4a12',
      emissiveIntensity: 0.72,
      side: THREE.DoubleSide,
      selfLight: 0.82,
    }),
  };
  const materialFor: Record<BiomePropFamily, THREE.MeshBasicMaterial> = {
    trunk: materials.bark,
    canopy: materials.foliage,
    conifer: materials.foliage,
    frond: materials.foliage,
    groundCover: materials.ground,
    reed: materials.ground,
    cactus: materials.foliage,
    deadwood: materials.bark,
    rock: materials.mineral,
    mesa: materials.mineral,
    crystal: materials.crystal,
    snow: materials.snow,
    water: materials.water,
    glow: materials.glow,
  };
  for (const geometry of new Set(Object.values(geometries))) {
    bakeFacetLighting(geometry);
  }
  const accumulators = {} as BiomePropAccumulators;

  for (const family of BIOME_PROP_FAMILIES) {
    const mesh = new THREE.InstancedMesh(geometries[family], materialFor[family], capacity);
    mesh.name = `streamed-biome-${family}-instances`;
    mesh.count = 0;
    mesh.castShadow = false;
    mesh.receiveShadow = family === 'water' || family === 'snow';
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(mesh);
    accumulators[family] = { mesh, count: 0 };
  }

  return {
    accumulators,
    geometries: Array.from(new Set(Object.values(geometries))),
    materials: Object.values(materials),
  };
}

function createHorizonSilhouetteGeometry(
  radius: number,
  baseHeight: number,
  amplitude: number,
  phase: number,
): THREE.BufferGeometry {
  const segments = 128;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  for (let index = 0; index <= segments; index += 1) {
    const angle = index / segments * Math.PI * 2;
    const variation =
      Math.sin(angle * 3 + phase) * 0.38
      + Math.sin(angle * 7 - phase * 0.6) * 0.24
      + Math.sin(angle * 13 + phase * 1.3) * 0.12
      + Math.sin(angle * 23 - phase) * 0.06;
    const ridgeHeight = baseHeight + amplitude * (0.64 + variation);
    const radialVariation = 1
      + Math.sin(angle * 2 + phase) * 0.028
      + Math.sin(angle * 11 - phase) * 0.012;
    const currentRadius = radius * radialVariation;
    const x = Math.cos(angle) * currentRadius;
    const z = Math.sin(angle) * currentRadius;
    positions.push(x, -30, z, x, ridgeHeight, z);
    colors.push(1, 1, 1, 0, 1, 1, 1, 0.78);
  }
  for (let index = 0; index < segments; index += 1) {
    const base = index * 2;
    const next = (index + 1) * 2;
    indices.push(base, next, base + 1, next, next + 1, base + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function createBiomeHorizonSystem(): BiomeHorizonSystem {
  const group = new THREE.Group();
  group.name = 'travelling-biome-atmospheric-horizon';
  const silhouetteGeometry = createHorizonSilhouetteGeometry(1240, 18, 42, 0.6);
  const silhouetteMaterial = new THREE.MeshBasicMaterial({
    name: 'biome-horizon-subtle-silhouette',
    color: '#9cb5af',
    transparent: true,
    opacity: 0.13,
    vertexColors: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  });
  const silhouette = new THREE.Mesh(silhouetteGeometry, silhouetteMaterial);
  silhouette.name = 'biome-horizon-single-silhouette';
  silhouette.renderOrder = -18;
  // The streamed 3x3 terrain already extends beyond the full-fog distance.
  // Keeping the silhouette as a fallback resource but hidden avoids a pale
  // alpha band when the camera climbs above it.
  silhouette.visible = false;
  group.add(silhouette);
  group.frustumCulled = false;
  let activeBiome: BiomeId | '' = '';

  return {
    group,
    geometries: [silhouetteGeometry],
    materials: [silhouetteMaterial],
    update: (focusPosition, biome) => {
      group.position.set(
        Math.round(focusPosition.x / 24) * 24,
        0,
        Math.round(focusPosition.z / 24) * 24,
      );
      if (activeBiome === biome.id) return;
      activeBiome = biome.id;
      HORIZON_COLOR_SCRATCH.set(biome.rockColor).lerp(HORIZON_FOG_COLOR, 0.84);
      silhouetteMaterial.color.copy(HORIZON_COLOR_SCRATCH);
    },
  };
}
